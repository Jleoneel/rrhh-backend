import bcrypt from "bcrypt";
import { pool } from "../../db.js";

const CARGOS_PERMITIDOS = [
  'ASISTENTE DE LA UATH',
  'RESPONSABLE DE LA UATH',
  'JEFE DE AREA',
  'ADMINISTRADOR DEL SISTEMA',
];

async function getCargoId(nombreCargo) {
  const r = await pool.query(
    `SELECT id FROM core.cargo WHERE UPPER(nombre) = UPPER($1) AND activo = true LIMIT 1`,
    [nombreCargo]
  );
  if (r.rowCount === 0) throw new Error(`No existe el cargo '${nombreCargo}'`);
  return r.rows[0].id;
}

export async function listFirmantesUath(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT 
        f.id, f.numero_identificacion AS cedula,
        f.nombre, f.activo, f.cargo_id,
        c.nombre AS cargo_nombre
      FROM core.firmante f
      LEFT JOIN core.cargo c ON c.id = f.cargo_id
      WHERE c.nombre = ANY($1)
      ORDER BY c.nombre, f.nombre ASC;
    `, [CARGOS_PERMITIDOS]);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function createFirmanteUath(req, res) {
  const { cedula, nombre, password, cargo } = req.body;

  if (!cedula || !nombre || !password || !cargo) {
    return res.status(400).json({ message: "cedula, nombre, password y cargo son requeridos" });
  }

  if (!CARGOS_PERMITIDOS.includes(cargo)) {
    return res.status(400).json({ message: "Cargo no permitido" });
  }

  const cleanCedula = String(cedula).trim();
  if (!/^\d{10}$/.test(cleanCedula)) {
    return res.status(400).json({ message: "La cédula debe tener 10 dígitos" });
  }

  try {
    const cargoId = await getCargoId(cargo);

    const existe = await pool.query(
      `SELECT 1 FROM core.firmante WHERE numero_identificacion = $1 LIMIT 1`,
      [cleanCedula]
    );
    if (existe.rowCount > 0) {
      return res.status(409).json({ message: "Ya existe un firmante con esa cédula" });
    }

    const hash = await bcrypt.hash(String(password), 10);

    const { rows } = await pool.query(`
      INSERT INTO core.firmante (numero_identificacion, nombre, activo, cargo_id, password_hash)
      VALUES ($1, $2, true, $3, $4)
      RETURNING id, numero_identificacion AS cedula, nombre, activo, cargo_id
    `, [cleanCedula, String(nombre).trim(), cargoId, hash]);

    return res.status(201).json({ message: "Firmante creado", firmante: rows[0] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function updateFirmante(req, res) {
  const { id } = req.params;
  const { nombre, activo } = req.body;

  if (nombre == null && activo == null) {
    return res.status(400).json({ message: "Debe enviar nombre y/o activo" });
  }

  try {
    const { rows } = await pool.query(`
      UPDATE core.firmante
      SET nombre = COALESCE($2, nombre), activo = COALESCE($3, activo)
      WHERE id = $1
      RETURNING id, numero_identificacion AS cedula, nombre, activo, cargo_id
    `, [id, nombre?.trim?.() ?? null, typeof activo === "boolean" ? activo : null]);

    if (!rows.length) return res.status(404).json({ message: "Firmante no encontrado" });
    return res.json({ message: "Firmante actualizado", firmante: rows[0] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function resetPasswordFirmante(req, res) {
  const { id } = req.params;
  const { password } = req.body;

  if (!password) return res.status(400).json({ message: "password es requerido" });

  try {
    const hash = await bcrypt.hash(String(password), 10);
    const { rows } = await pool.query(`
      UPDATE core.firmante SET password_hash = $2 WHERE id = $1
      RETURNING id, numero_identificacion AS cedula, nombre
    `, [id, hash]);

    if (!rows.length) return res.status(404).json({ message: "Firmante no encontrado" });
    return res.json({ message: "Contraseña actualizada", firmante: rows[0] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}