import { Router } from "express";
import { pool } from "../../../db.js";
import {
  requireAuth,
  requireServidor,
} from "../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../shared/utils/sseManager.js";

const router = Router();

// GET /api/permisos/mis-permisos
router.get("/mis-permisos", requireAuth, requireServidor, async (req, res) => {
  const { servidor_id } = req.user;
  try {
    const { rows } = await pool.query(
      `
      SELECT
        ps.id, ps.fecha, ps.hora_salida, ps.hora_regreso,
        ps.horas_solicitadas, ps.motivo, ps.estado,
        ps.observacion_jefe, ps.fecha_respuesta, ps.created_at,
        pt.nombre AS tipo_permiso
      FROM core.permiso_solicitud ps
      JOIN core.permiso_tipo pt ON pt.id = ps.permiso_tipo_id
      WHERE ps.servidor_id = $1
      ORDER BY ps.created_at DESC;
    `,
      [servidor_id],
    );
    return res.json(rows);
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error obteniendo permisos", error: err.message });
  }
});

// POST /api/permisos/solicitar
router.post("/solicitar", requireAuth, requireServidor, async (req, res) => {
  const { servidor_id, unidad_organica_id } = req.user;
  const { permiso_tipo_id, fecha, hora_salida, hora_regreso, motivo } =
    req.body;

  if (!permiso_tipo_id || !fecha || !hora_salida || !hora_regreso) {
    return res.status(400).json({ message: "Todos los campos son requeridos" });
  }

  const salida = new Date(`2000-01-01T${hora_salida}`);
  const regreso = new Date(`2000-01-01T${hora_regreso}`);
  const horas_solicitadas = (regreso - salida) / (1000 * 60 * 60);

  if (horas_solicitadas <= 0) {
    return res
      .status(400)
      .json({ message: "La hora de regreso debe ser posterior" });
  }

  const anio = new Date(fecha).getFullYear();
  const client = await pool.connect(); // ← primero declarar client

  try {
    await client.query("BEGIN");

    // ← Validar duplicado AQUÍ dentro del try
    const duplicadoR = await client.query(
      `
      SELECT id FROM core.permiso_solicitud
      WHERE servidor_id = $1
        AND fecha = $2
        AND estado NOT IN ('RECHAZADO', 'CANCELADO')
      LIMIT 1
    `,
      [servidor_id, fecha],
    );

    if (duplicadoR.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Ya tienes una solicitud de permiso activa para ese día",
      });
    }

    const saldoR = await client.query(
      `
      SELECT horas_totales, horas_usadas
      FROM core.saldo_permiso
      WHERE servidor_id = $1 AND anio = $2
    `,
      [servidor_id, anio],
    );

    if (!saldoR.rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "No tiene saldo asignado para este año" });
    }

    const disponibles =
      saldoR.rows[0].horas_totales - saldoR.rows[0].horas_usadas;
    if (horas_solicitadas > disponibles) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: `Saldo insuficiente. Disponible: ${disponibles}h, Solicitado: ${horas_solicitadas}h`,
      });
    }

    const unidadR = await client.query(
      `SELECT jefe_id FROM core.unidad_organica WHERE id = $1`,
      [unidad_organica_id],
    );

    const jefe_firmante_id = unidadR.rows[0]?.jefe_id || null;

    const { rows } = await client.query(
      `
      INSERT INTO core.permiso_solicitud
        (servidor_id, permiso_tipo_id, unidad_organica_id, fecha,
         hora_salida, hora_regreso, horas_solicitadas, motivo, jefe_firmante_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
      [
        servidor_id,
        permiso_tipo_id,
        unidad_organica_id,
        fecha,
        hora_salida,
        hora_regreso,
        horas_solicitadas,
        motivo || null,
        jefe_firmante_id,
      ],
    );

    await client.query("COMMIT");

    if (jefe_firmante_id) {
      await pool.query(
        `
        INSERT INTO core.notificacion_permiso (solicitud_id, firmante_id, tipo)
        VALUES ($1, $2, 'NUEVA_SOLICITUD')
      `,
        [rows[0].id, jefe_firmante_id],
      );

      notifyCargoId(`permiso-firmante-${jefe_firmante_id}`, {
        tipo: "NUEVA_SOLICITUD",
        solicitud_id: rows[0].id,
        mensaje: "Tienes una nueva solicitud de permiso pendiente",
      });
    }

    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    return res
      .status(500)
      .json({ message: "Error creando solicitud", error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/permisos/solicitar/:id/cancelar
router.put("/:id/cancelar", requireAuth, requireServidor, async (req, res) => {
  const { servidor_id } = req.user;
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const solicitudR = await client.query(
      `
      SELECT id, estado, servidor_id 
      FROM core.permiso_solicitud 
      WHERE id = $1
    `,
      [id],
    );

    if (!solicitudR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Solicitud no encontrada" });
    }

    const solicitud = solicitudR.rows[0];

    // Verificar que es el dueño
    if (solicitud.servidor_id !== servidor_id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "No autorizado" });
    }

    // Solo PENDIENTE puede cancelarse
    if (solicitud.estado !== "PENDIENTE") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Solo se pueden cancelar solicitudes en estado PENDIENTE",
      });
    }

    await client.query(
      `
      UPDATE core.permiso_solicitud 
      SET estado = 'CANCELADO' 
      WHERE id = $1
    `,
      [id],
    );

    await client.query("COMMIT");
    return res.json({ message: "Solicitud cancelada correctamente" });
  } catch (err) {
    await client.query("ROLLBACK");
    return res
      .status(500)
      .json({ message: "Error cancelando solicitud", error: err.message });
  } finally {
    client.release();
  }
});

export default router;
