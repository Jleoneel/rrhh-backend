import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { pool } from "../db.js";

export async function loginByCedula(req, res) {
  const { cedula, password } = req.body;

  if (!cedula || !password) {
    return res
      .status(400)
      .json({ message: "Cédula y contraseña son requeridas" });
  }

  try {
    const q = `
      SELECT 
        f.id, 
        f.numero_identificacion, 
        f.nombre, 
        f.cargo_id, 
        f.activo, 
        f.password_hash,
        c.nombre AS cargo_nombre
      FROM core.firmante f
      LEFT JOIN core.cargo c ON c.id = f.cargo_id
      WHERE f.numero_identificacion = $1
      LIMIT 1;
    `;

    const r = await pool.query(q, [cedula.trim()]);

    if (r.rowCount === 0) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const firmante = r.rows[0];

    if (!firmante.activo) {
      return res.status(403).json({ message: "Firmante inactivo" });
    }

    // CONDICIONAL: Verificar que password_hash NO sea null o vacío
    if (!firmante.password_hash || firmante.password_hash.trim() === "") {
      return res.status(403).json({
        message: "Este usuario no tiene contraseña configurada",
        code: "NO_PASSWORD_SET",
      });
    }

    // CONDICION DE SEGURIDAD: bcrypt.compare puede fallar con hash inválido
    let passwordValida = false;
    try {
      // Asegurarse de que el hash tenga el formato correcto
      const hash = firmante.password_hash.trim();

      // Verificar formato básico de bcrypt (debe empezar con $2a$, $2b$, etc.)
      if (
        !hash.startsWith("$2a$") &&
        !hash.startsWith("$2b$") &&
        !hash.startsWith("$2y$")
      ) {
        return res.status(500).json({
          message: "Formato de contraseña inválido en la base de datos",
          code: "INVALID_HASH_FORMAT",
        });
      }

      passwordValida = await bcrypt.compare(password.trim(), hash);
    } catch (bcryptError) {
      console.error("Error en bcrypt.compare:", bcryptError);
      return res.status(500).json({
        message: "Error validando contraseña",
        error: bcryptError.message,
        code: "BCRYPT_ERROR",
      });
    }

    if (!passwordValida) {
      return res.status(401).json({
        message: "Contraseña incorrecta, vuelva a intentarlo",
        code: "INVALID_PASSWORD",
      });
    }

    const token = jwt.sign(
      {
        sub: firmante.id,
        cargo_id: firmante.cargo_id,
        nombre: firmante.nombre,
        es_admin: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.json({
      token,
      firmante: {
        id: firmante.id,
        nombre: firmante.nombre,
        cedula: firmante.numero_identificacion,
        cargo_id: firmante.cargo_id,
        cargo_nombre: firmante.cargo_nombre,
        es_admin: true,
      },
    });
  } catch (error) {
    console.error("Error en login con password:", error);
    return res.status(500).json({
      message: "Error interno del servidor",
      error: error.message,
      code: "SERVER_ERROR",
    });
  }
}
