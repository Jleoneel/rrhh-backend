import { pool } from "../db.js";

// Crear o actualizar notificación
export async function registrarNotificacion(req, res) {
  const { id, accion_id, fecha, hora, medio, nombre, puesto } = req.body;
  try {
    if (id) {
      const qUpdate = `
        UPDATE core.notificacion_accion
        SET fecha = $1,
            hora = $2,
            medio = $3,
            nombre = $4,
            puesto = $5
        WHERE id = $6
        RETURNING *;
      `;

      const r = await pool.query(qUpdate, [
        fecha,
        hora,
        medio,
        nombre,
        puesto,
        id
      ]);

      return res.json(r.rows[0]);
    }

    const qInsert = `
      INSERT INTO core.notificacion_accion
      (accion_id, fecha, hora, medio, nombre, puesto)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;

    const r = await pool.query(qInsert, [
      accion_id,
      fecha,
      hora,
      medio,
      nombre,
      puesto
    ]);

    return res.status(201).json(r.rows[0]);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Consultar por acción
export async function consultarNotificacion(req, res) {
  const { accionId } = req.params;

  try {
    const q = `
      SELECT *
      FROM core.notificacion_accion
      WHERE accion_id = $1
      LIMIT 1;
    `;

    const r = await pool.query(q, [accionId]);

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "No existe notificación" });
    }

    return res.json(r.rows[0]);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}