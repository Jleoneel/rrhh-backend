import { Router } from "express";
import { pool } from "../../../../db.js";
import { requireAuth, requireServidor } from "../../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../../shared/utils/sseManager.js";

const router = Router();

// GET /api/permisos/mis-vacaciones
router.get("/mis-vacaciones", requireAuth, requireServidor, async (req, res) => {
  const { servidor_id } = req.user;
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
      WHERE vs.servidor_id = $1
      ORDER BY vs.created_at DESC
    `, [servidor_id]);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo vacaciones", error: err.message });
  }
});

// POST /api/permisos/solicitar-vacacion
router.post("/solicitar-vacacion", requireAuth, requireServidor, async (req, res) => {
  const { servidor_id, unidad_organica_id } = req.user;
  const { tipo, fecha_inicio, fecha_fin, dias_solicitados, telefono_domicilio, telefono_movil } = req.body;

  if (!tipo || !fecha_inicio || !fecha_fin || !dias_solicitados)
    return res.status(400).json({ message: "Todos los campos son requeridos" });
  if (!["VACACION_PROGRAMADA", "PERMISO_CON_CARGO"].includes(tipo))
    return res.status(400).json({ message: "Tipo de solicitud inválido" });
  if (new Date(fecha_fin) < new Date(fecha_inicio))
    return res.status(400).json({ message: "La fecha fin debe ser posterior a la fecha inicio" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

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

    const jefe_firmante_id = unidadR.rows[0]?.jefe_id || null;
    const gerente_id = unidadR.rows[0]?.jefe_superior_id || null;

    const { rows } = await client.query(`
      INSERT INTO core.vacacion_solicitud
        (servidor_id, tipo, fecha_inicio, fecha_fin, dias_solicitados,
         jefe_firmante_id, gerente_id, telefono_domicilio, telefono_movil)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [servidor_id, tipo, fecha_inicio, fecha_fin, dias_solicitados,
        jefe_firmante_id, gerente_id, telefono_domicilio || null, telefono_movil || null]);

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

// PUT /api/permisos/:id/cancelar-vacacion
router.put("/:id/cancelar-vacacion", requireAuth, requireServidor, async (req, res) => {
  const { servidor_id } = req.user;
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const solicitudR = await client.query(`
      SELECT id, estado, servidor_id FROM core.vacacion_solicitud WHERE id = $1
    `, [id]);

    if (!solicitudR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Solicitud no encontrada" });
    }

    const solicitud = solicitudR.rows[0];

    if (solicitud.servidor_id !== servidor_id) {
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