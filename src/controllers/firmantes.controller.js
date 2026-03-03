import bcrypt from "bcrypt";
import { pool } from "../db.js";

// Controladores para gestión de firmantes UATH
async function getCargoUathId() {
  const q = `
    SELECT id
    FROM core.cargo
    WHERE UPPER(nombre) = 'ASISTENTE DE LA UATH'
      AND activo = true
    LIMIT 1;
  `;
  const r = await pool.query(q);
  if (r.rowCount === 0) {
    throw new Error("No existe el cargo 'ASISTENTE DE LA UATH' o está inactivo");
  }
  return r.rows[0].id;
}

// Listar firmantes con cargo de UATH
export async function listFirmantesUath(req, res) {
  try {
    const cargoUathId = await getCargoUathId();

    const q = `
      SELECT 
        f.id,
        f.numero_identificacion AS cedula,
        f.nombre,
        f.activo,
        f.cargo_id,
        c.nombre AS cargo_nombre
      FROM core.firmante f
      LEFT JOIN core.cargo c ON c.id = f.cargo_id
      WHERE f.cargo_id = $1
      ORDER BY f.nombre ASC;
    `;

    const r = await pool.query(q, [cargoUathId]);
    return res.json(r.rows);
  } catch (error) {
    console.error("listFirmantesUath:", error);
    return res.status(500).json({ message: error.message });
  }
}

// Crear nuevo firmante con cargo de UATH
export async function createFirmanteUath(req, res) {
  const { cedula, nombre, password } = req.body;

  if (!cedula || !nombre || !password) {
    return res.status(400).json({
      message: "cedula, nombre y password son requeridos",
    });
  }

  const cleanCedula = String(cedula).trim();
  if (!/^\d{10}$/.test(cleanCedula)) {
    return res.status(400).json({ message: "La cédula debe tener 10 dígitos" });
  }

  try {
    const cargoUathId = await getCargoUathId();

    // Verificar duplicado por cédula
    const existsQ = `
      SELECT 1
      FROM core.firmante
      WHERE numero_identificacion = $1
      LIMIT 1;
    `;
    const existsR = await pool.query(existsQ, [cleanCedula]);
    if (existsR.rowCount > 0) {
      return res.status(409).json({ message: "Ya existe un firmante con esa cédula" });
    }

    const hash = await bcrypt.hash(String(password), 10);

    const insertQ = `
      INSERT INTO core.firmante (
        numero_identificacion,
        nombre,
        activo,
        cargo_id,
        password_hash
      )
      VALUES ($1, $2, true, $3, $4)
      RETURNING 
        id,
        numero_identificacion AS cedula,
        nombre,
        activo,
        cargo_id;
    `;

    const r = await pool.query(insertQ, [cleanCedula, String(nombre).trim(), cargoUathId, hash]);

    return res.status(201).json({
      message: "Firmante UATH creado",
      firmante: r.rows[0],
    });
  } catch (error) {
    console.error("createFirmanteUath:", error);
    return res.status(500).json({ message: error.message });
  }
}

// Actualizar nombre y/o estado activo de un firmante UATH
export async function updateFirmante(req, res) {
  const { id } = req.params;
  const { nombre, activo } = req.body;

  if (nombre == null && activo == null) {
    return res.status(400).json({ message: "Debe enviar nombre y/o activo" });
  }

  try {
    const q = `
      UPDATE core.firmante
      SET
        nombre = COALESCE($2, nombre),
        activo = COALESCE($3, activo)
      WHERE id = $1
      RETURNING
        id,
        numero_identificacion AS cedula,
        nombre,
        activo,
        cargo_id;
    `;
    const r = await pool.query(q, [id, nombre?.trim?.() ?? null, typeof activo === "boolean" ? activo : null]);

    if (r.rowCount === 0) {
      return res.status(404).json({ message: "Firmante no encontrado" });
    }

    return res.json({ message: "Firmante actualizado", firmante: r.rows[0] });
  } catch (error) {
    console.error("updateFirmante:", error);
    return res.status(500).json({ message: error.message });
  }
}

// Resetear contraseña de un firmante UATH
export async function resetPasswordFirmante(req, res) {
  const { id } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ message: "password es requerido" });
  }

  try {
    const hash = await bcrypt.hash(String(password), 10);

    const q = `
      UPDATE core.firmante
      SET password_hash = $2
      WHERE id = $1
      RETURNING id, numero_identificacion AS cedula, nombre;
    `;
    const r = await pool.query(q, [id, hash]);

    if (r.rowCount === 0) {
      return res.status(404).json({ message: "Firmante no encontrado" });
    }

    return res.json({ message: "Contraseña actualizada", firmante: r.rows[0] });
  } catch (error) {
    console.error("resetPasswordFirmante:", error);
    return res.status(500).json({ message: error.message });
  }
}
