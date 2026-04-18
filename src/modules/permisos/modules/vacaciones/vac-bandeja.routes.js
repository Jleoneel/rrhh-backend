import { Router } from "express";
import { pool } from "../../../../db.js";
import { requireAuth, requireFirmante } from "../../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../../shared/utils/sseManager.js";

const router = Router();

// GET /api/permisos/bandeja-vacaciones
router.get("/bandeja-vacaciones", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  try {
    const { rows } = await pool.query(`
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado, vs.created_at,
        vs.archivo_jefe, vs.archivo_superior, vs.archivo_uath,
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
        (vs.jefe_firmante_id = $1 AND vs.estado = 'PENDIENTE_JEFE') OR
        (vs.gerente_id = $1 AND vs.estado = 'PENDIENTE_GERENTE') OR
        (vs.uath_id = $1 AND vs.estado = 'PENDIENTE_UATH')
      )
      ORDER BY vs.created_at ASC
    `, [firmante_id]);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo bandeja", error: err.message });
  }
});

// GET /api/permisos/reporte-vacaciones
router.get("/reporte-vacaciones", requireAuth, requireFirmante, async (req, res) => {
  const { fecha, estado } = req.query;
  try {
    let where = "WHERE 1=1";
    const values = [];
    let i = 1;

    if (fecha) { where += ` AND vs.fecha_solicitud = $${i}`; values.push(fecha); i++; }
    if (estado && estado !== "TODOS") { where += ` AND vs.estado = $${i}`; values.push(estado); i++; }

    const { rows } = await pool.query(`
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado, vs.archivo_uath,
        TO_CHAR(vs.fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
        sv.nombres AS servidor_nombre,
        sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica,
        fj.nombre AS jefe_nombre
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      LEFT JOIN core.firmante fj ON fj.id = vs.jefe_firmante_id
      ${where}
      ORDER BY vs.created_at DESC
    `, values);

    return res.json({ total: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo reporte", error: err.message });
  }
});

// PUT /api/permisos/:id/responder-vacacion
router.put("/:id/responder-vacacion", requireAuth, requireFirmante, async (req, res) => {
  const { id } = req.params;
  const { aprobado, observacion } = req.body;
  const { firmante_id } = req.user;

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

    if (!aprobado) {
      await client.query(`
        UPDATE core.vacacion_solicitud
        SET estado = 'NEGADO',
            observacion_jefe = CASE WHEN $2 THEN $3 ELSE observacion_jefe END,
            observacion_gerente = CASE WHEN $4 THEN $3 ELSE observacion_gerente END,
            fecha_respuesta_jefe = CASE WHEN $2 THEN NOW() ELSE fecha_respuesta_jefe END,
            fecha_respuesta_gerente = CASE WHEN $4 THEN NOW() ELSE fecha_respuesta_gerente END
        WHERE id = $1
      `, [id, esJefe, observacion || null, esGerente]);

    } else if (esJefe) {
      const nuevoEstado = solicitud.gerente_id ? "PENDIENTE_GERENTE" : "PENDIENTE_UATH";
      let uath_id = null;
      if (!solicitud.gerente_id) {
        const uathR = await client.query(`
          SELECT f.id FROM core.firmante f JOIN core.cargo c ON c.id = f.cargo_id
          WHERE c.nombre = 'RESPONSABLE DE LA UATH' AND f.activo = true LIMIT 1
        `);
        uath_id = uathR.rows[0]?.id || null;
      }
      await client.query(`
        UPDATE core.vacacion_solicitud
        SET estado = $2, observacion_jefe = $3, fecha_respuesta_jefe = NOW(),
            uath_id = COALESCE($4, uath_id)
        WHERE id = $1
      `, [id, nuevoEstado, observacion || null, uath_id]);

    } else if (esGerente) {
      const horas = parseFloat(solicitud.dias_solicitados) * 8;
      await client.query(`
        UPDATE core.saldo_permiso SET horas_usadas = horas_usadas + $1, updated_at = NOW()
        WHERE servidor_id = $2
      `, [horas, solicitud.servidor_id]);

      await client.query(`
        INSERT INTO core.permiso_movimiento (servidor_id, horas, tipo, descripcion, creado_por)
        VALUES ($1, $2, 'DESCUENTO', 'Vacaciones aprobadas por jefe superior', $3)
      `, [solicitud.servidor_id, horas, firmante_id]);

      const uathR = await client.query(`
        SELECT f.id FROM core.firmante f JOIN core.cargo c ON c.id = f.cargo_id
        WHERE c.nombre IN ('ASISTENTE DE LA UATH', 'RESPONSABLE DE LA UATH') AND f.activo = true
        ORDER BY c.nombre DESC LIMIT 1
      `);
      const uath_id = uathR.rows[0]?.id || null;

      await client.query(`
        UPDATE core.vacacion_solicitud
        SET estado = 'PENDIENTE_UATH', observacion_gerente = $2,
            fecha_respuesta_gerente = NOW(), uath_id = $3
        WHERE id = $1
      `, [id, observacion || null, uath_id]);

    } else if (esUath) {
      await client.query(`
        UPDATE core.vacacion_solicitud
        SET estado = 'APROBADO', observacion_uath = $2,
            fecha_respuesta_uath = NOW(), uath_id = $3
        WHERE id = $1
      `, [id, observacion || null, firmante_id]);
    }

    await client.query("COMMIT");

    const firmanteVinculadoR = await pool.query(`
      SELECT f.id AS firmante_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE sv.id = $1 LIMIT 1
    `, [solicitud.servidor_id]);

    const firmanteVinculado = firmanteVinculadoR.rows[0]?.firmante_id || null;
    const estadoFinal = aprobado ? (esUath ? "APROBADO" : "EN_PROCESO") : "NEGADO";

    if (estadoFinal !== "EN_PROCESO") {
      if (firmanteVinculado) {
        notifyCargoId(`permiso-firmante-${firmanteVinculado}`, {
          tipo: estadoFinal,
          mensaje: estadoFinal === "APROBADO" ? "Tus vacaciones fueron aprobadas" : "Tu solicitud de vacaciones fue negada",
        });
      } else {
        notifyCargoId(`permiso-servidor-${solicitud.servidor_id}`, {
          tipo: estadoFinal,
          mensaje: estadoFinal === "APROBADO" ? "Tus vacaciones fueron aprobadas" : "Tu solicitud de vacaciones fue negada",
        });
      }
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