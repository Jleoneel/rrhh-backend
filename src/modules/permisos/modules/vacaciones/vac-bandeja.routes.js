import { Router } from "express";
import { pool } from "../../../../db.js";
import { requireAuth, requireFirmante } from "../../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../../shared/utils/sseManager.js";

const router = Router();

// GET /api/permisos/bandeja-vacaciones
//
// Incluye tanto lo pendiente de este firmante como su HISTORIAL: toda
// solicitud en la que ya participó (ya respondió en su paso), sin
// importar qué pasó después en pasos posteriores — igual que
// bandeja.routes.js (permisos por horas), que no filtra por estado, solo
// por jefe_firmante_id.
router.get("/bandeja-vacaciones", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  try {
    const { rows } = await pool.query(`
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado, vs.created_at,
        vs.archivo_solicitante, vs.archivo_jefe, vs.archivo_superior, vs.archivo_uath,
        vs.observacion_jefe, vs.observacion_gerente, vs.observacion_uath,
        (
          (vs.jefe_firmante_id = $1 AND vs.estado = 'PENDIENTE_JEFE') OR
          (vs.gerente_id = $1 AND vs.estado = 'PENDIENTE_GERENTE') OR
          (vs.uath_id = $1 AND vs.estado = 'PENDIENTE_UATH')
        ) AS es_mi_turno,
        TO_CHAR(vs.fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
        sv.nombres AS servidor_nombre,
        sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      JOIN core.puesto p ON p.id = ap.puesto_id
      JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      WHERE (
        (vs.jefe_firmante_id = $1 AND (vs.estado = 'PENDIENTE_JEFE' OR vs.fecha_respuesta_jefe IS NOT NULL)) OR
        (vs.gerente_id = $1 AND (vs.estado = 'PENDIENTE_GERENTE' OR vs.fecha_respuesta_gerente IS NOT NULL)) OR
        (vs.uath_id = $1 AND (vs.estado = 'PENDIENTE_UATH' OR vs.fecha_respuesta_uath IS NOT NULL))
      )
      ORDER BY
        CASE WHEN vs.estado IN ('PENDIENTE_JEFE', 'PENDIENTE_GERENTE', 'PENDIENTE_UATH') THEN 1 ELSE 2 END,
        vs.created_at DESC
    `, [firmante_id]);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo bandeja", error: err.message });
  }
});

// GET /api/permisos/reporte-vacaciones
router.get("/reporte-vacaciones", requireAuth, requireFirmante, async (req, res) => {
  const {
    fecha,
    estado,
    unidad_organica_id,
    search = "",
    todos,
    page = 1,
    limit = 10,
  } = req.query;

  // A diferencia del reporte de permisos, aquí "todos" es el modo por
  // defecto: una solicitud de vacaciones no es algo que se revise "por
  // día" como un permiso puntual, así que solo se filtra por fecha de
  // solicitud si el usuario explícitamente pide ver un día concreto.
  const verDia = todos === "false" || todos === "0";
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let where = "WHERE 1=1";
    const values = [];
    let i = 1;

    if (verDia) {
      const fechaFinal = fecha || new Date().toISOString().split("T")[0];
      where += ` AND vs.fecha_solicitud = $${i}`;
      values.push(fechaFinal);
      i++;
    }
    if (estado && estado !== "TODOS") {
      where += ` AND vs.estado = $${i}`;
      values.push(estado);
      i++;
    }
    if (unidad_organica_id) {
      where += ` AND u.id = $${i}`;
      values.push(unidad_organica_id);
      i++;
    }
    if (search) {
      where += ` AND (sv.nombres ILIKE $${i} OR sv.numero_identificacion ILIKE $${i})`;
      values.push(`%${search}%`);
      i++;
    }

    const countResult = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      ${where}
    `,
      values,
    );
    const total = parseInt(countResult.rows[0].total);

    const resumenResult = await pool.query(
      `
      SELECT
        CASE WHEN vs.estado LIKE 'PENDIENTE%' THEN 'PENDIENTE' ELSE vs.estado END AS grupo,
        COUNT(*) AS n
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      ${where}
      GROUP BY grupo
    `,
      values,
    );
    const resumen = { PENDIENTE: 0, APROBADO: 0, NEGADO: 0 };
    for (const r of resumenResult.rows) {
      resumen[r.grupo] = parseInt(r.n);
    }

    const { rows } = await pool.query(`
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado, vs.archivo_uath,
        TO_CHAR(vs.fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
        sv.nombres AS servidor_nombre,
        sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica,
        fj.nombre AS jefe_nombre,
        vs.archivo_uath
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      LEFT JOIN core.firmante fj ON fj.id = vs.jefe_firmante_id
      ${where}
      ORDER BY vs.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, [...values, parseInt(limit), offset]);

    return res.json({
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

// PUT /api/permisos/:id/responder-vacacion
router.put("/:id/responder-vacacion", requireAuth, requireFirmante, async (req, res) => {
  const { id } = req.params;
  const { aprobado, observacion } = req.body;
  const { firmante_id } = req.user;

  if (aprobado) {
    return res.status(400).json({
      message:
        "La aprobación de vacaciones se realiza firmando la solicitud con tu certificado digital.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const solicitudR = await client.query(`SELECT * FROM core.vacacion_solicitud WHERE id = $1`, [id]);

    if (!solicitudR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Solicitud no encontrada" });
    }

    const solicitud = solicitudR.rows[0];
    const esJefe = solicitud.jefe_firmante_id === firmante_id && solicitud.estado === "PENDIENTE_JEFE";
    const esGerente = solicitud.gerente_id === firmante_id && solicitud.estado === "PENDIENTE_GERENTE";
    const esUath = solicitud.uath_id === firmante_id && solicitud.estado === "PENDIENTE_UATH";

    if (!esJefe && !esGerente && !esUath) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "No autorizado para responder esta solicitud" });
    }

    if (esGerente && solicitud.jefe_firmante_id === firmante_id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "No puedes aprobar en dos pasos del mismo flujo" });
    }

    await client.query(`
      UPDATE core.vacacion_solicitud
      SET estado = 'NEGADO',
          observacion_jefe = CASE WHEN $2 THEN $3 ELSE observacion_jefe END,
          observacion_gerente = CASE WHEN $4 THEN $3 ELSE observacion_gerente END,
          fecha_respuesta_jefe = CASE WHEN $2 THEN NOW() ELSE fecha_respuesta_jefe END,
          fecha_respuesta_gerente = CASE WHEN $4 THEN NOW() ELSE fecha_respuesta_gerente END
      WHERE id = $1
    `, [id, esJefe, observacion || null, esGerente]);

    await client.query("COMMIT");

    const firmanteVinculadoR = await pool.query(`
      SELECT f.id AS firmante_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE sv.id = $1 LIMIT 1
    `, [solicitud.servidor_id]);

    const firmanteVinculado = firmanteVinculadoR.rows[0]?.firmante_id || null;

    if (firmanteVinculado) {
      notifyCargoId(`permiso-firmante-${firmanteVinculado}`, {
        tipo: "NEGADO",
        mensaje: "Tu solicitud de vacaciones fue negada",
      });
    } else {
      notifyCargoId(`permiso-servidor-${solicitud.servidor_id}`, {
        tipo: "NEGADO",
        mensaje: "Tu solicitud de vacaciones fue negada",
      });
    }

    return res.json({ message: "Solicitud procesada correctamente" });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error procesando solicitud", error: err.message });
  } finally {
    client.release();
  }
});

export default router;
