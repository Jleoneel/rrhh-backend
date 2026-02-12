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

export async function listarFirmasAccion(req, res) {
  const { accionId } = req.params;

  const q = `
    SELECT
      af.id,
      af.accion_id,
      af.orden,
      af.rol_firma,
      af.estado,
      af.firmado_en,
      af.observacion,
      af.cargo_id,
      c.nombre AS cargo_nombre,
      af.firmante_id,
      f.nombre AS firmante_nombre,
      af.documento_id,
      d.archivo_path AS documento_path,
      d.version AS documento_version
    FROM core.accion_firma af
    JOIN core.cargo c ON c.id = af.cargo_id
    LEFT JOIN core.firmante f ON f.id = af.firmante_id
    LEFT JOIN core.accion_documento d ON d.id = af.documento_id
    WHERE af.accion_id = $1
    ORDER BY af.orden ASC;
  `;

  const r = await pool.query(q, [accionId]);
  return res.json({ count: r.rowCount, items: r.rows });
}

export async function firmaPendienteAccion(req, res) {
  const { accionId } = req.params;

  const q = `
    SELECT
      af.id,
      af.accion_id,
      af.orden,
      af.rol_firma,
      af.cargo_id,
      c.nombre AS cargo_nombre,
      af.estado
    FROM core.accion_firma af
    JOIN core.cargo c ON c.id = af.cargo_id
    WHERE af.accion_id = $1
      AND af.estado = 'PENDIENTE'
    ORDER BY af.orden ASC
    LIMIT 1;
  `;

  const r = await pool.query(q, [accionId]);

  if (!r.rows.length) {
    return res.json(null);
  }

  return res.json(r.rows[0]);
}

