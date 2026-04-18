import { Router } from "express";
import { pool } from "../../../../db.js";
import { requireAuth, requireFirmante } from "../../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../../shared/utils/sseManager.js";

const router = Router();

// GET /api/permisos/mis-vacaciones-firmante
router.get("/mis-vacaciones-firmante", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  try {
    const { rows } = await pool.query(`
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado,
        vs.observacion_jefe, vs.observacion_gerente, vs.observacion_uath,
        TO_CHAR(vs.fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
        vs.created_at
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      JOIN core.firmante f ON f.numero_identificacion = sv.numero_identificacion
      WHERE f.id = $1
      ORDER BY vs.created_at DESC
    `, [firmante_id]);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo vacaciones", error: err.message });
  }
});

// POST /api/permisos/solicitar-vacacion-firmante
router.post("/solicitar-vacacion-firmante", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  const { tipo, fecha_inicio, fecha_fin, dias_solicitados, telefono_domicilio, telefono_movil } = req.body;

  if (!tipo || !fecha_inicio || !fecha_fin || !dias_solicitados)
    return res.status(400).json({ message: "Todos los campos son requeridos" });
  if (new Date(fecha_fin) < new Date(fecha_inicio))
    return res.status(400).json({ message: "La fecha fin debe ser posterior a la fecha inicio" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const svR = await client.query(`
      SELECT sv.id AS servidor_id, p.unidad_organica_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      WHERE f.id = $1 LIMIT 1
    `, [firmante_id]);

    if (!svR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "No se encontró servidor vinculado. Contacte a UATH." });
    }

    const { servidor_id, unidad_organica_id } = svR.rows[0];

    const pendienteR = await client.query(`
      SELECT id FROM core.vacacion_solicitud
      WHERE servidor_id = $1 AND estado NOT IN ('APROBADO', 'NEGADO') LIMIT 1
    `, [servidor_id]);

    if (pendienteR.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Tienes una solicitud de vacaciones en proceso. Espera la respuesta antes de solicitar otra." });
    }

    const solapamientoR = await client.query(`
      SELECT id FROM core.vacacion_solicitud
      WHERE servidor_id = $1 AND estado NOT IN ('NEGADO')
        AND fecha_inicio <= $3 AND fecha_fin >= $2 LIMIT 1
    `, [servidor_id, fecha_inicio, fecha_fin]);

    if (solapamientoR.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Ya tienes vacaciones aprobadas o en proceso en ese período de fechas." });
    }

    const saldoR = await client.query(`
      SELECT horas_totales, horas_usadas FROM core.saldo_permiso WHERE servidor_id = $1
    `, [servidor_id]);

    if (!saldoR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "No tiene saldo asignado. Contacte a UATH." });
    }

    const horas_solicitadas = parseFloat(dias_solicitados) * 8;
    const disponibles = saldoR.rows[0].horas_totales - saldoR.rows[0].horas_usadas;

    if (horas_solicitadas > disponibles) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: `Saldo insuficiente. Disponible: ${(disponibles / 8).toFixed(1)} días, Solicitado: ${dias_solicitados} días` });
    }

    const unidadR = await client.query(`
      SELECT jefe_id, jefe_superior_id FROM core.unidad_organica WHERE id = $1
    `, [unidad_organica_id]);

    const jefe_id_raw = unidadR.rows[0]?.jefe_id || null;
    const jefe_superior_id = unidadR.rows[0]?.jefe_superior_id || null;
    const esPropio = jefe_id_raw === firmante_id;
    const jefe_firmante_id = esPropio ? jefe_superior_id : jefe_id_raw;

    let gerente_id_final = null;
    if (!esPropio) {
      const gerenteR = await client.query(`
        SELECT jefe_superior_id AS gerente_id FROM core.unidad_organica
        WHERE jefe_id = $1 LIMIT 1
      `, [jefe_firmante_id]);
      gerente_id_final = gerenteR.rows[0]?.gerente_id || jefe_superior_id || null;
    } else {
      const gerenteR = await client.query(`
        SELECT jefe_superior_id AS gerente_id FROM core.unidad_organica
        WHERE jefe_id = $1 LIMIT 1
      `, [jefe_superior_id]);
      gerente_id_final = gerenteR.rows[0]?.gerente_id || null;
    }

    const { rows } = await client.query(`
      INSERT INTO core.vacacion_solicitud
        (servidor_id, tipo, fecha_inicio, fecha_fin, dias_solicitados,
         jefe_firmante_id, gerente_id, telefono_domicilio, telefono_movil)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [servidor_id, tipo, fecha_inicio, fecha_fin, dias_solicitados,
        jefe_firmante_id, gerente_id_final, telefono_domicilio || null, telefono_movil || null]);

    await client.query("COMMIT");

    if (jefe_firmante_id) {
      await pool.query(`
        INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo)
        VALUES ($1, $2, 'NUEVA_SOLICITUD')
      `, [rows[0].id, jefe_firmante_id]);

      notifyCargoId(`permiso-firmante-${jefe_firmante_id}`, {
        tipo: "NUEVA_SOLICITUD", vacacion_id: rows[0].id,
        mensaje: "Nueva solicitud de vacaciones pendiente", es_vacacion: true,
      });
    }

    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error creando solicitud", error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/permisos/:id/cancelar-vacacion-firmante
router.put("/:id/cancelar-vacacion-firmante", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const svR = await client.query(`
      SELECT sv.id AS servidor_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE f.id = $1 LIMIT 1
    `, [firmante_id]);

    if (!svR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Servidor no encontrado" });
    }

    const solicitudR = await client.query(`
      SELECT id, estado, servidor_id FROM core.vacacion_solicitud WHERE id = $1
    `, [id]);

    if (!solicitudR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Solicitud no encontrada" });
    }

    const solicitud = solicitudR.rows[0];

    if (solicitud.servidor_id !== svR.rows[0].servidor_id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "No autorizado" });
    }
    if (solicitud.estado === "APROBADO") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "No se puede cancelar una solicitud ya aprobada" });
    }

    await client.query(`DELETE FROM core.notificacion_permiso WHERE vacacion_solicitud_id = $1`, [id]);
    await client.query(`DELETE FROM core.vacacion_solicitud WHERE id = $1`, [id]);

    await client.query("COMMIT");
    return res.json({ message: "Solicitud cancelada correctamente" });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error cancelando", error: err.message });
  } finally {
    client.release();
  }
});

export default router;