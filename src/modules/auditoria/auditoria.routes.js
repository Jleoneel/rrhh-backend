import { Router } from "express";
import { pool } from "../../db.js";
import {
  requireAuth,
  requireAdmin,
} from "../../shared/middleware/auth.middleware.js";
import {
  ACCION_AUDITORIA,
  GRUPO_AUDITORIA,
} from "../../shared/constants/auditoria.js";

const router = Router();

// GET /api/auditoria — solo Administrador del Sistema (es_admin).
// Filtros opcionales: accion, desde, hasta, firmante_id, servidor_id,
// paginado con page/limit. El nombre de quién actuó y del servidor
// afectado se resuelve aquí con JOIN (no se guarda duplicado en la
// tabla) para que siempre muestre el dato actual.
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
  const offset = (page - 1) * limit;

  const { accion, grupo, desde, hasta, firmante_id, servidor_id, q } =
    req.query;

  // El filtro por texto necesita los JOIN ya resueltos (nombre/cédula),
  // así que las condiciones que lo usan van en la consulta final, no en
  // el COUNT separado — por eso ambas consultas arman su propio WHERE
  // sobre los mismos parámetros base y agregan "q" al final si aplica.
  const condiciones = [];
  const params = [];

  // "grupo" (clic en la tarjeta Saldos/Vacaciones/Permisos) filtra por
  // TODAS las acciones de esa categoría; "accion" (el select del filtro
  // detallado) filtra por una sola — mutuamente excluyentes, grupo gana
  // si ambos vienen por error.
  if (grupo && GRUPO_AUDITORIA[grupo]) {
    params.push(GRUPO_AUDITORIA[grupo]);
    condiciones.push(`a.accion = ANY($${params.length})`);
  } else if (accion && Object.values(ACCION_AUDITORIA).includes(accion)) {
    params.push(accion);
    condiciones.push(`a.accion = $${params.length}`);
  }
  if (desde) {
    params.push(desde);
    condiciones.push(`a.created_at >= $${params.length}`);
  }
  if (hasta) {
    params.push(hasta);
    condiciones.push(`a.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }
  if (firmante_id) {
    params.push(firmante_id);
    condiciones.push(`a.firmante_id = $${params.length}`);
  }
  if (servidor_id) {
    params.push(servidor_id);
    condiciones.push(`a.servidor_afectado_id = $${params.length}`);
  }
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    condiciones.push(
      `(f.nombre ILIKE $${params.length} OR sv.nombres ILIKE $${params.length} OR sv.numero_identificacion ILIKE $${params.length})`,
    );
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const joins = `
      JOIN core.firmante f ON f.id = a.firmante_id
      LEFT JOIN core.cargo c ON c.id = f.cargo_id
      LEFT JOIN core.servidor sv ON sv.id = a.servidor_afectado_id
  `;

  try {
    const totalR = await pool.query(
      `SELECT COUNT(*) FROM core.auditoria a ${joins} ${where}`,
      params,
    );

    const porAccionR = await pool.query(
      `SELECT a.accion, COUNT(*) FROM core.auditoria a ${joins} ${where} GROUP BY a.accion`,
      params,
    );
    const porAccion = Object.fromEntries(
      porAccionR.rows.map((r) => [r.accion, parseInt(r.count)]),
    );

    params.push(limit, offset);
    const { rows } = await pool.query(
      `
      SELECT
        a.id, a.accion, a.descripcion, a.detalle,
        a.recurso_tipo, a.recurso_id, a.created_at,
        f.id AS firmante_id, f.nombre AS firmante_nombre, c.nombre AS firmante_cargo,
        sv.id AS servidor_afectado_id, sv.nombres AS servidor_afectado_nombre,
        sv.numero_identificacion AS servidor_afectado_cedula
      FROM core.auditoria a
      ${joins}
      ${where}
      ORDER BY a.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );

    return res.json({
      data: rows,
      total: parseInt(totalR.rows[0].count),
      por_accion: porAccion,
      page,
      limit,
    });
  } catch (err) {
    console.error("Error obteniendo auditoría:", err);
    return res.status(500).json({ message: "Error obteniendo auditoría" });
  }
});

// GET /api/auditoria/acciones — catálogo de acciones para el filtro del front
router.get("/acciones", requireAuth, requireAdmin, (req, res) => {
  return res.json(Object.values(ACCION_AUDITORIA));
});

export default router;
