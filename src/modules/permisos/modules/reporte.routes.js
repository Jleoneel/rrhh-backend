import { Router } from "express";
import { pool } from "../../../db.js";
import { requireAuth, requireFirmante } from "../../../shared/middleware/auth.middleware.js";

const router = Router();

// GET /api/permisos/reporte
router.get("/reporte", requireAuth, requireFirmante, async (req, res) => {
  const {
    fecha,
    estado,
    unidad_organica_id,
    search = "",
    todos,
    page = 1,
    limit = 10,
  } = req.query;

  const verTodos = todos === "true" || todos === "1";
  const fechaFinal = !verTodos ? fecha || new Date().toISOString().split("T")[0] : null;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let whereClause = "WHERE 1=1";
    const values = [];
    let i = 1;

    if (!verTodos) {
      whereClause += ` AND ps.fecha = $${i}`;
      values.push(fechaFinal);
      i++;
    }

    if (estado && estado !== "TODOS") {
      whereClause += ` AND ps.estado = $${i}`;
      values.push(estado);
      i++;
    }

    if (unidad_organica_id) {
      whereClause += ` AND ps.unidad_organica_id = $${i}`;
      values.push(unidad_organica_id);
      i++;
    }

    if (search) {
      whereClause += ` AND (sv.nombres ILIKE $${i} OR sv.numero_identificacion ILIKE $${i})`;
      values.push(`%${search}%`);
      i++;
    }

    const countResult = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM core.permiso_solicitud ps
      JOIN core.servidor sv ON sv.id = ps.servidor_id
      ${whereClause}
    `,
      values,
    );
    const total = parseInt(countResult.rows[0].total);

    // Conteo por estado sobre TODO lo que coincide con los filtros (no solo
    // la página actual), para los cards de resumen del reporte.
    const resumenResult = await pool.query(
      `
      SELECT ps.estado, COUNT(*) AS n
      FROM core.permiso_solicitud ps
      JOIN core.servidor sv ON sv.id = ps.servidor_id
      ${whereClause}
      GROUP BY ps.estado
    `,
      values,
    );
    const resumen = { PENDIENTE: 0, APROBADO: 0, RECHAZADO: 0, CANCELADO: 0 };
    for (const r of resumenResult.rows) {
      resumen[r.estado] = parseInt(r.n);
    }

    const { rows } = await pool.query(
      `
      SELECT
        ps.id,
        ps.fecha,
        ps.hora_salida,
        ps.hora_regreso,
        ps.horas_solicitadas,
        ps.motivo,
        ps.estado,
        ps.observacion_jefe,
        ps.fecha_respuesta,
        ps.created_at,
        pt.nombre AS tipo_permiso,
        sv.nombres AS servidor_nombre,
        sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica,
        f.nombre AS jefe_nombre,
        ps.archivo_evidencia
      FROM core.permiso_solicitud ps
      JOIN core.permiso_tipo pt ON pt.id = ps.permiso_tipo_id
      JOIN core.servidor sv ON sv.id = ps.servidor_id
      JOIN core.unidad_organica u ON u.id = ps.unidad_organica_id
      LEFT JOIN core.firmante f ON f.id = ps.jefe_firmante_id
      ${whereClause}
      ORDER BY ps.fecha DESC, u.nombre ASC, sv.nombres ASC
      LIMIT $${i} OFFSET $${i + 1}
    `,
      [...values, parseInt(limit), offset],
    );

    return res.json({
      fecha: fechaFinal,
      data: rows,
      total,
      resumen,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.max(1, Math.ceil(total / parseInt(limit))),
    });
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo reporte", error: err.message });
  }
});

export default router;
