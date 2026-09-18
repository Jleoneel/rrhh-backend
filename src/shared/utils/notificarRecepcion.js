import { pool } from "../../db.js";
import { notifyServidorId } from "./sseManager.js";
import { enviarCorreo } from "./email.service.js";

// Se llama justo cuando una Acción de Personal termina la cadena
// institucional y queda APROBADO — avisa al servidor (correo + SSE +
// notificación persistente) de que ya puede firmar su recepción. No
// bloquea el flujo de firma: cualquier error aquí solo se loguea.
export async function notificarRecepcionPendiente(accionId) {
  try {
    const r = await pool.query(
      `
      SELECT ap.codigo_elaboracion, ta.nombre AS tipo_accion,
             sv.id AS servidor_id, sv.nombres AS servidor_nombre, sv.email
      FROM core.accion_personal ap
      JOIN core.tipo_accion ta ON ta.id = ap.tipo_accion_id
      JOIN core.servidor sv ON sv.id = ap.servidor_id
      WHERE ap.id = $1
      `,
      [accionId],
    );
    const info = r.rows[0];
    if (!info) return;

    await pool.query(
      `INSERT INTO core.notificacion_recibido_servidor (servidor_id, accion_id)
       VALUES ($1, $2)`,
      [info.servidor_id, accionId],
    );

    notifyServidorId(info.servidor_id, {
      tipo: "RECEPCION_PENDIENTE",
      accion_id: accionId,
      tipo_accion: info.tipo_accion,
      codigo_elaboracion: info.codigo_elaboracion,
      mensaje: "Tienes una Acción de Personal para firmar como recibida",
    });

    if (info.email) {
      await enviarCorreo(info.email, "accionRecepcionPendiente", {
        servidor_nombre: info.servidor_nombre,
        tipo_accion: info.tipo_accion,
        codigo_elaboracion: info.codigo_elaboracion,
      });
    }
  } catch (err) {
    console.error(
      `[NOTIF RECEPCION] Error notificando accion ${accionId}:`,
      err.message,
    );
  }
}
