import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { pool } from "../../db.js";

function esHashValido(hash) {
  return (
    hash?.startsWith("$2a$") ||
    hash?.startsWith("$2b$") ||
    hash?.startsWith("$2y$")
  );
}

export async function loginByCedula(req, res) {
  const { cedula, password } = req.body;

  if (!cedula || !password) {
    return res.status(400).json({ message: "Cédula y contraseña son requeridas" });
  }

  try {
    // Buscar en firmantes
    const qFirmante = `
      SELECT 
        f.id, f.numero_identificacion, f.nombre,
        f.cargo_id, f.activo, f.password_hash,
        c.nombre AS cargo_nombre
      FROM core.firmante f
      LEFT JOIN core.cargo c ON c.id = f.cargo_id
      WHERE f.numero_identificacion = $1
      LIMIT 1;
    `;
    const rFirmante = await pool.query(qFirmante, [cedula.trim()]);

    if (rFirmante.rowCount > 0) {
      const firmante = rFirmante.rows[0];

      if (!firmante.activo) {
        return res.status(403).json({ message: "Usuario inactivo" });
      }

      if (!firmante.password_hash || firmante.password_hash.trim() === "") {
        return res.status(403).json({
          message: "Este usuario no tiene contraseña configurada",
          code: "NO_PASSWORD_SET",
        });
      }

      const hash = firmante.password_hash.trim();
      if (!esHashValido(hash)) {
        return res.status(500).json({
          message: "Formato de contraseña inválido",
          code: "INVALID_HASH_FORMAT",
        });
      }

      const passwordValida = await bcrypt.compare(password.trim(), hash);
      if (!passwordValida) {
        return res.status(401).json({
          message: "Contraseña incorrecta, vuelva a intentarlo",
          code: "INVALID_PASSWORD",
        });
      }

      const ADMIN_CARGO_ID = (process.env.ADMIN_CARGO_ID || "").trim();
      const es_admin = ADMIN_CARGO_ID !== "" && firmante.cargo_id === ADMIN_CARGO_ID;

      const jefeR = await pool.query(
        `SELECT id FROM core.unidad_organica 
         WHERE jefe_id = $1 OR jefe_superior_id = $1 LIMIT 1`,
        [firmante.id]
      );
      const es_jefe = jefeR.rowCount > 0;

      const token = jwt.sign(
        {
          sub: firmante.id,
          cargo_id: firmante.cargo_id,
          nombre: firmante.nombre,
          es_admin,
          tipo_usuario: "FIRMANTE",
          es_jefe,
        },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
      );

      return res.json({
        token,
        firmante: {
          id: firmante.id,
          nombre: firmante.nombre,
          cedula: firmante.numero_identificacion,
          cargo_id: firmante.cargo_id,
          cargo_nombre: firmante.cargo_nombre,
          es_admin,
          tipo_usuario: "FIRMANTE",
          es_jefe,
        },
      });
    }

    //Buscar en servidores
    const qServidor = `
      SELECT
        us.id, us.password_hash, us.activo,
        sv.id AS servidor_id,
        sv.nombres, sv.numero_identificacion,
        u.id AS unidad_organica_id,
        u.nombre AS unidad_organica,
        d.nombre AS denominacion_puesto
      FROM core.usuario_servidor us
      JOIN core.servidor sv ON sv.id = us.servidor_id
      LEFT JOIN core.asignacion_puesto ap 
        ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      LEFT JOIN core.denominacion_puesto d ON d.id = p.denominacion_puesto_id
      WHERE sv.numero_identificacion = $1
      LIMIT 1;
    `;
    const rServidor = await pool.query(qServidor, [cedula.trim()]);

    if (rServidor.rowCount === 0) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const servidor = rServidor.rows[0];

    if (!servidor.activo) {
      return res.status(403).json({ message: "Usuario inactivo" });
    }

    const hash = servidor.password_hash?.trim();
    if (!esHashValido(hash)) {
      return res.status(500).json({
        message: "Formato de contraseña inválido",
        code: "INVALID_HASH_FORMAT",
      });
    }

    const passwordValida = await bcrypt.compare(password.trim(), hash);
    if (!passwordValida) {
      return res.status(401).json({
        message: "Contraseña incorrecta, vuelva a intentarlo",
        code: "INVALID_PASSWORD",
      });
    }

    const token = jwt.sign(
      {
        sub: servidor.id,
        servidor_id: servidor.servidor_id,
        nombre: servidor.nombres,
        unidad_organica_id: servidor.unidad_organica_id,
        es_admin: false,
        tipo_usuario: "SERVIDOR",
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({
      token,
      firmante: {
        id: servidor.id,
        nombre: servidor.nombres,
        cedula: servidor.numero_identificacion,
        cargo_id: null,
        cargo_nombre: servidor.denominacion_puesto,
        es_admin: false,
        tipo_usuario: "SERVIDOR",
        unidad_organica_id: servidor.unidad_organica_id,
        unidad_organica: servidor.unidad_organica,
      },
    });

  } catch (error) {
    console.error("Error en login:", error);
    return res.status(500).json({
      message: "Error interno del servidor",
      error: error.message,
      code: "SERVER_ERROR",
    });
  }
}

export async function cambiarPassword(req, res) {
  const { passwordActual, passwordNueva } = req.body;
  const firmanteId = req.user.firmante_id;

  if (!passwordActual || !passwordNueva) {
    return res.status(400).json({ message: "Todos los campos son requeridos" });
  }

  if (passwordNueva.length < 6) {
    return res.status(400).json({
      message: "La nueva contraseña debe tener al menos 6 caracteres",
    });
  }

  try {
    const tipoUsuario = req.user.tipo_usuario;
    let hash;

    if (tipoUsuario === "SERVIDOR") {
      const r = await pool.query(
        `SELECT password_hash FROM core.usuario_servidor WHERE id = $1`,
        [firmanteId]
      );
      if (r.rowCount === 0) return res.status(404).json({ message: "Usuario no encontrado" });
      hash = r.rows[0].password_hash?.trim();
    } else {
      const r = await pool.query(
        `SELECT password_hash FROM core.firmante WHERE id = $1`,
        [firmanteId]
      );
      if (r.rowCount === 0) return res.status(404).json({ message: "Usuario no encontrado" });
      hash = r.rows[0].password_hash?.trim();
    }

    const passwordValida = await bcrypt.compare(passwordActual.trim(), hash);
    if (!passwordValida) {
      return res.status(401).json({ message: "La contraseña actual es incorrecta" });
    }

    const nuevoHash = await bcrypt.hash(passwordNueva.trim(), 10);

    if (tipoUsuario === "SERVIDOR") {
      await pool.query(
        `UPDATE core.usuario_servidor SET password_hash = $1 WHERE id = $2`,
        [nuevoHash, firmanteId]
      );
    } else {
      await pool.query(
        `UPDATE core.firmante SET password_hash = $1 WHERE id = $2`,
        [nuevoHash, firmanteId]
      );
    }

    return res.json({ message: "Contraseña actualizada correctamente" });
  } catch (error) {
    return res.status(500).json({ message: "Error interno del servidor" });
  }
}