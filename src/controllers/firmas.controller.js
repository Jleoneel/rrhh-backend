import { pool } from "../db.js";

export async function misFirmasPendientes(req, res) {
  const { cargo_id } = req.user;

  const q = `
    SELECT
      af.id AS accion_firma_id,
      af.accion_id,
      af.orden,
      af.rol_firma,
      af.estado,
      ta.nombre AS tipo_accion,
      ap.motivo,
      ap.estado AS estado_accion,
      ap.fecha_elaboracion
    FROM core.accion_firma af
    JOIN core.accion_personal ap ON ap.id = af.accion_id
    JOIN core.tipo_accion ta ON ta.id = ap.tipo_accion_id
    WHERE af.estado = 'PENDIENTE'
      AND af.cargo_id = $1
    ORDER BY ap.fecha_elaboracion DESC, af.orden ASC;
  `;

  const r = await pool.query(q, [cargo_id]);
  return res.json({ count: r.rowCount, items: r.rows });
}
