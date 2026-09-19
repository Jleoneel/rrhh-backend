import { pool } from "../../db.js";

// Controlador para listar todas las firmas de una acción personal, con detalles de documento y firmante
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
      af.servidor_id,
      sv.nombres AS servidor_nombre,
      af.firmante_id,
      f.nombre AS firmante_nombre
    FROM core.accion_firma af
    LEFT JOIN core.cargo c ON c.id = af.cargo_id
    LEFT JOIN core.servidor sv ON sv.id = af.servidor_id
    LEFT JOIN core.firmante f ON f.id = af.firmante_id
    WHERE af.accion_id = $1
    ORDER BY af.orden ASC;
  `;

  const r = await pool.query(q, [accionId]);
  return res.json({ count: r.rowCount, items: r.rows });
}

// Controlador para obtener la siguiente firma pendiente de una acción personal (para mostrar en el detalle de la acción)
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
      af.servidor_id,
      sv.nombres AS servidor_nombre,
      af.estado
    FROM core.accion_firma af
    LEFT JOIN core.cargo c ON c.id = af.cargo_id
    LEFT JOIN core.servidor sv ON sv.id = af.servidor_id
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

