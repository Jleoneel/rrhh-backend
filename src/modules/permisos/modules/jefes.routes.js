import { Router } from "express";
import { pool } from "../../../db.js";
import bcrypt from "bcrypt";
import { requireAuth, requireFirmante } from "../../../shared/middleware/auth.middleware.js";

const router = Router();

// GET /api/permisos/jefes
router.get("/jefes", requireAuth, requireFirmante, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.nombre AS unidad_organica,
        f1.id AS jefe_id, f1.nombre AS jefe_nombre,
        f2.id AS jefe_superior_id, f2.nombre AS jefe_superior_nombre
      FROM core.unidad_organica u
      LEFT JOIN core.firmante f1 ON f1.id = u.jefe_id
      LEFT JOIN core.firmante f2 ON f2.id = u.jefe_superior_id
      ORDER BY u.nombre ASC;
    `);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo jefes", error: err.message });
  }
});

// PUT /api/permisos/jefes/:unidadId
router.put("/jefes/:unidadId", requireAuth, requireFirmante, async (req, res) => {
  const { unidadId } = req.params;
  const { jefe_id, jefe_superior_id } = req.body;

  try {
    const { rows } = await pool.query(
      `
      UPDATE core.unidad_organica
      SET jefe_id = $1, jefe_superior_id = $2
      WHERE id = $3
      RETURNING id, nombre, jefe_id, jefe_superior_id
    `,
      [jefe_id || null, jefe_superior_id || null, unidadId],
    );

    if (!rows.length) return res.status(404).json({ message: "Unidad no encontrada" });
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ message: "Error asignando jefe", error: err.message });
  }
});

// POST /api/permisos/jefes-firmante
router.post("/jefes-firmante", requireAuth, requireFirmante, async (req, res) => {
  const { cedula, nombre, password, unidad_organica_id } = req.body;

  if (!cedula || !nombre || !password || !unidad_organica_id) {
    return res.status(400).json({ message: "Todos los campos son requeridos" });
  }

  if (!/^\d{10}$/.test(cedula.trim())) {
    return res.status(400).json({ message: "La cédula debe tener 10 dígitos" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existe = await client.query(
      `SELECT id FROM core.firmante WHERE numero_identificacion = $1 LIMIT 1`,
      [cedula.trim()],
    );
    if (existe.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Ya existe un usuario con esa cédula" });
    }

    const cargoR = await client.query(
      `SELECT id FROM core.cargo WHERE nombre = 'JEFE DE AREA' AND activo = true LIMIT 1`,
    );
    if (!cargoR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "No existe el cargo JEFE DE AREA" });
    }

    const cargo_id = cargoR.rows[0].id;
    const hash = await bcrypt.hash(password.trim(), 10);

    const firmanteR = await client.query(
      `
      INSERT INTO core.firmante (numero_identificacion, nombre, activo, cargo_id, password_hash)
      VALUES ($1, $2, true, $3, $4)
      RETURNING id
    `,
      [cedula.trim(), nombre.trim().toUpperCase(), cargo_id, hash],
    );

    const firmante_id = firmanteR.rows[0].id;

    await client.query(
      `
      INSERT INTO core.jefe_unidad (unidad_organica_id, firmante_id, activo)
      VALUES ($1, $2, true)
      ON CONFLICT (unidad_organica_id)
      DO UPDATE SET firmante_id = $2, activo = true
    `,
      [unidad_organica_id, firmante_id],
    );

    await client.query("COMMIT");
    return res.status(201).json({ message: "Jefe de área creado y asignado correctamente" });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error creando jefe", error: err.message });
  } finally {
    client.release();
  }
});

export default router;