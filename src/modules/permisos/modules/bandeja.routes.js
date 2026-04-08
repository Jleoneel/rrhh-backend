import { Router } from "express";
import { pool } from "../../../db.js";
import {
  requireAuth,
  requireFirmante,
} from "../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../shared/utils/sseManager.js";

const router = Router();

// GET /api/permisos/bandeja
router.get("/bandeja", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  try {
    const { rows } = await pool.query(`
      SELECT
        ps.id, ps.fecha, ps.hora_salida, ps.hora_regreso,
        ps.horas_solicitadas, ps.motivo, ps.estado,
        ps.observacion_jefe, ps.fecha_respuesta, ps.created_at,
        pt.nombre AS tipo_permiso,
        sv.nombres AS servidor_nombre,
        sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica
      FROM core.permiso_solicitud ps
      JOIN core.permiso_tipo pt ON pt.id = ps.permiso_tipo_id
      JOIN core.servidor sv ON sv.id = ps.servidor_id
      JOIN core.unidad_organica u ON u.id = ps.unidad_organica_id
      WHERE ps.jefe_firmante_id = $1
      ORDER BY 
        CASE ps.estado WHEN 'PENDIENTE' THEN 1 WHEN 'APROBADO' THEN 2 ELSE 3 END,
        ps.created_at DESC;
    `, [firmante_id]);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo bandeja", error: err.message });
  }
});

// PUT /api/permisos/:id/responder
router.put("/:id/responder", requireAuth, requireFirmante, async (req, res) => {
  const { id } = req.params;
  const { estado, observacion } = req.body;
  const { firmante_id } = req.user;

  if (!["APROBADO", "RECHAZADO"].includes(estado)) {
    return res.status(400).json({ message: "Estado debe ser APROBADO o RECHAZADO" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const solicitudR = await client.query(
      `SELECT * FROM core.permiso_solicitud WHERE id = $1 AND jefe_firmante_id = $2`,
      [id, firmante_id],
    );

    if (!solicitudR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Solicitud no encontrada o no autorizado" });
    }

    const solicitud = solicitudR.rows[0];

    if (solicitud.estado !== "PENDIENTE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Esta solicitud ya fue procesada" });
    }

    await client.query(`
      UPDATE core.permiso_solicitud
      SET estado = $1, observacion_jefe = $2, fecha_respuesta = NOW()
      WHERE id = $3
    `, [estado, observacion || null, id]);

    if (estado === "APROBADO") {

      const tipoR = await client.query(
        `SELECT nombre FROM core.permiso_tipo WHERE id = $1`,
        [solicitud.permiso_tipo_id],
      );

      const tipoNombre = tipoR.rows[0]?.nombre || "";

      if (tipoNombre === "Personal") {
        await client.query(`
          UPDATE core.saldo_permiso
          SET horas_usadas = horas_usadas + $1, updated_at = NOW()
          WHERE servidor_id = $2
        `, [solicitud.horas_solicitadas, solicitud.servidor_id]);

        await client.query(`
          INSERT INTO core.permiso_movimiento
            (servidor_id, solicitud_id, horas, tipo, descripcion, creado_por)
          VALUES ($1, $2, $3, 'DESCUENTO', 'Permiso personal aprobado', $4)
            `,[solicitud.servidor_id, id, solicitud.horas_solicitadas, firmante_id]);
      }
    }

    await client.query("COMMIT");

    // Buscar si el servidor tiene firmante vinculado
    const firmanteR = await pool.query(`
      SELECT f.id AS firmante_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE sv.id = $1
      LIMIT 1
    `, [solicitud.servidor_id]);

    const firmanteVinculado = firmanteR.rows[0]?.firmante_id || null;

    if (firmanteVinculado) {
      await pool.query(`
        INSERT INTO core.notificacion_permiso (solicitud_id, firmante_id, tipo)
        VALUES ($1, $2, $3)
      `, [id, firmanteVinculado, estado]);

      notifyCargoId(`permiso-firmante-${firmanteVinculado}`, {
        tipo: estado,
        solicitud_id: id,
        mensaje: estado === "APROBADO"
          ? "Tu permiso fue aprobado"
          : "Tu permiso fue rechazado",
      });
    } else {
      await pool.query(`
        INSERT INTO core.notificacion_permiso (solicitud_id, servidor_id, tipo)
        VALUES ($1, $2, $3)
      `, [id, solicitud.servidor_id, estado]);

      notifyCargoId(`permiso-servidor-${solicitud.servidor_id}`, {
        tipo: estado,
        solicitud_id: id,
        mensaje: estado === "APROBADO"
          ? "Tu permiso fue aprobado"
          : "Tu permiso fue rechazado",
      });
    }

    return res.json({ message: `Permiso ${estado.toLowerCase()} correctamente` });

  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error procesando solicitud", error: err.message });
  } finally {
    client.release();
  }
});

export default router;