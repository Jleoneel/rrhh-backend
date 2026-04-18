import { Router } from "express";
import { pool } from "../../../db.js";
import {
  requireAuth,
  requireFirmante,
} from "../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../shared/utils/sseManager.js";

const router = Router();

// GET /api/permisos/mis-permisos-firmante
router.get(
  "/mis-permisos-firmante",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
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
      JOIN core.servidor sv ON sv.id = ps.servidor_id
      JOIN core.firmante f ON f.numero_identificacion = sv.numero_identificacion
      WHERE f.id = $1
      ORDER BY ps.created_at DESC
    `,
        [firmante_id],
      );
      return res.json(rows);
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error obteniendo permisos", error: err.message });
    }
  },
);

// POST /api/permisos/solicitar-firmante
router.post(
  "/solicitar-firmante",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    const { permiso_tipo_id, fecha, hora_salida, hora_regreso, motivo } =
      req.body;

    if (!permiso_tipo_id || !fecha || !hora_salida || !hora_regreso) {
      return res
        .status(400)
        .json({ message: "Todos los campos son requeridos" });
    }

    const salida = new Date(`2000-01-01T${hora_salida}`);
    const regreso = new Date(`2000-01-01T${hora_regreso}`);
    const horas_solicitadas = (regreso - salida) / (1000 * 60 * 60);

    if (horas_solicitadas <= 0) {
      return res
        .status(400)
        .json({ message: "La hora de regreso debe ser posterior" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Obtener servidor vinculado
      const svR = await client.query(
        `
      SELECT sv.id AS servidor_id, p.unidad_organica_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      WHERE f.id = $1
      LIMIT 1
    `,
        [firmante_id],
      );

      if (!svR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          message: "No se encontró servidor vinculado. Contacte a UATH.",
        });
      }

      const { servidor_id, unidad_organica_id } = svR.rows[0];

      const { fecha, hora_salida, hora_regreso } = req.body;

      const duplicadoR = await client.query(
        `
  SELECT id FROM core.permiso_solicitud
  WHERE servidor_id = $1
    AND fecha = $2
    AND estado NOT IN ('CANCELADO', 'RECHAZADO')
    AND hora_salida < $4
    AND hora_regreso > $3
  LIMIT 1
`,
        [servidor_id, fecha, hora_salida, hora_regreso],
      );

      if (duplicadoR.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message:
            "Ya tienes un permiso en ese horario. Los permisos no pueden solaparse.",
        });
      }

      // Verificar saldo
      const saldoR = await client.query(
        `
      SELECT horas_totales, horas_usadas
      FROM core.saldo_permiso
      WHERE servidor_id = $1
    `,
        [servidor_id],
      );

      if (!saldoR.rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "No tiene saldo asignado. Contacte a UATH." });
      }
      // Verificar saldo SOLO si es permiso Personal
      const tipoR = await client.query(
        `SELECT nombre FROM core.permiso_tipo WHERE id = $1`,
        [permiso_tipo_id],
      );
      const tipoNombre = tipoR.rows[0]?.nombre || "";

      if (tipoNombre === "Personal") {
        const disponibles =
          saldoR.rows[0].horas_totales - saldoR.rows[0].horas_usadas;
        if (horas_solicitadas > disponibles) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: `Saldo insuficiente. Disponible: ${disponibles}h, Solicitado: ${horas_solicitadas}h`,
          });
        }
      }

      const unidadR = await client.query(
        `SELECT jefe_superior_id FROM core.unidad_organica WHERE id = $1`,
        [unidad_organica_id],
      );

      const jefe_firmante_id = unidadR.rows[0]?.jefe_superior_id || null;

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
      //Notificar al jefe
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
  },
);

// PUT /api/permisos/:id/cancelar-firmante
router.put(
  "/:id/cancelar-firmante",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    const { id } = req.params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Obtener servidor vinculado al firmante
      const svR = await client.query(
        `
      SELECT sv.id AS servidor_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE f.id = $1
      LIMIT 1
    `,
        [firmante_id],
      );

      if (!svR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Servidor no encontrado" });
      }

      const { servidor_id } = svR.rows[0];

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

      if (solicitud.servidor_id !== servidor_id) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "No autorizado" });
      }

      if (solicitud.estado !== "PENDIENTE") {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ message: "Solo se pueden cancelar solicitudes PENDIENTE" });
      }

      await client.query(
        `
      UPDATE core.permiso_solicitud SET estado = 'CANCELADO' WHERE id = $1
    `,
        [id],
      );

      await client.query("COMMIT");
      return res.json({ message: "Solicitud cancelada correctamente" });
    } catch (err) {
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error cancelando", error: err.message });
    } finally {
      client.release();
    }
  },
);

export default router;
