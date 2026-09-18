import { pool } from "../../db.js";

// Resuelve el servidor "dueño" de la sesión actual, tanto si el usuario
// inició sesión como SERVIDOR (caso normal) como si inició sesión como
// FIRMANTE pero también existe como servidor con la misma cédula (ej. un
// JEFE DE AREA a quien también se le hace una Acción de Personal): el
// login siempre prioriza la cuenta de firmante cuando ambas comparten
// cédula (ver auth.controller.js), así que esa persona nunca podrá
// autenticarse como SERVIDOR para ver/firmar/ser notificada de su propia
// recepción si no se resuelve aquí también por cédula.
export async function resolverServidorPropio(req) {
  if (req.user.tipo_usuario === "SERVIDOR") {
    return { servidorId: req.user.servidor_id, viaFirmante: false };
  }
  if (req.user.tipo_usuario === "FIRMANTE") {
    const r = await pool.query(
      `SELECT sv.id
       FROM core.servidor sv
       JOIN core.firmante f ON f.numero_identificacion = sv.numero_identificacion
       WHERE f.id = $1
       LIMIT 1`,
      [req.user.firmante_id],
    );
    return { servidorId: r.rows[0]?.id || null, viaFirmante: true };
  }
  return { servidorId: null, viaFirmante: false };
}
