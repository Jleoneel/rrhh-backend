import { Router } from "express";
import { pool } from "../../../db.js";
import { requireAuth, requireFirmante } from "../../../shared/middleware/auth.middleware.js";

const router = Router();

// GET /api/permisos/reporte
router.get("/reporte", requireAuth, requireFirmante, async (req, res) => {
  const { fecha, estado } = req.query;
  const fechaFinal = fecha || new Date().toISOString().split("T")[0];

  try {
    let whereClause = `WHERE ps.fecha = $1`;
    const values = [fechaFinal];
    let i = 2;

    if (estado && estado !== "TODOS") {
      whereClause += ` AND ps.estado = $${i}`;
      values.push(estado);
      i++;
    }

    const { rows } = await pool.query(`
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
        f.nombre AS jefe_nombre
      FROM core.permiso_solicitud ps
      JOIN core.permiso_tipo pt ON pt.id = ps.permiso_tipo_id
      JOIN core.servidor sv ON sv.id = ps.servidor_id
      JOIN core.unidad_organica u ON u.id = ps.unidad_organica_id
      LEFT JOIN core.firmante f ON f.id = ps.jefe_firmante_id
      ${whereClause}
      ORDER BY u.nombre ASC, sv.nombres ASC;
    `, values);

    return res.json({
      fecha: fechaFinal,
      total: rows.length,
      data: rows,
    });
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo reporte", error: err.message });
  }
});

export default router;