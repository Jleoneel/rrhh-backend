import { pool } from "../../db.js";

// Código de core.regimen_laboral cuya firma electrónica es obligatoria al
// enviar una solicitud de vacaciones. En esta base solo existe un registro
// para "Servicio Civil Público" y "LOSEP" — es el mismo régimen (código 1,
// "SERVICIO CIVIL PUBLICO (LOSEP)"), no dos grupos distintos. Todo lo demás
// (Código del Trabajo, Pasivos, Jubilados Patronales, o sin régimen
// determinado) se mantiene opcional, como hasta ahora.
const CODIGO_REGIMEN_FIRMA_OBLIGATORIA = "1";

export const MENSAJE_FIRMA_OBLIGATORIA =
  "Tu régimen laboral (Servicio Civil Público - LOSEP) exige firmar electrónicamente la solicitud de vacaciones con tu certificado .p12. Súbelo en Mi Certificado y vuelve a intentar.";

// Régimen laboral (código) del puesto ACTIVO del servidor dado. null si no
// tiene una asignación activa o no se pudo determinar — en ese caso la
// firma queda opcional (no se bloquea a nadie por un dato incompleto).
export async function obtenerCodigoRegimen(servidorId) {
  if (!servidorId) return null;
  const { rows } = await pool.query(
    `SELECT rl.codigo
     FROM core.asignacion_puesto ap
     JOIN core.puesto p ON p.id = ap.puesto_id
     LEFT JOIN core.regimen_laboral rl ON rl.id = p.regimen_laboral_id
     WHERE ap.servidor_id = $1 AND ap.estado = 'ACTIVA'
     ORDER BY ap.id DESC
     LIMIT 1`,
    [servidorId],
  );
  return rows[0]?.codigo || null;
}

export function firmaEsObligatoria(codigoRegimen) {
  return codigoRegimen === CODIGO_REGIMEN_FIRMA_OBLIGATORIA;
}

// Tope de días de vacaciones acumulables (saldo_permiso), reglas fijas
// acordadas con RRHH:
// - dias_vacacion_anual = 40 (configuración puntual por servidor, botón
//   "Configurar días de vacaciones de este servidor") → tope 120 días.
// - Código del Trabajo (régimen "2") → tope 90 días.
// - LOSEP (régimen "1") u otros casos (sin régimen activo, Pasivos,
//   Jubilados Patronales — hoy sin servidores activos) → tope general 60.
export function calcularTopeDiasVacaciones(diasVacacionAnual, codigoRegimen) {
  if (diasVacacionAnual === 40) return 120;
  if (codigoRegimen === "2") return 90;
  return 60;
}

// Tope de días para un servidor puntual, resolviendo su dias_vacacion_anual
// y su régimen laboral actual en una sola consulta.
export async function obtenerTopeDiasVacaciones(servidorId) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(sv.dias_vacacion_anual, 30) AS dias_vacacion_anual,
       rl.codigo AS codigo_regimen
     FROM core.servidor sv
     LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
     LEFT JOIN core.puesto p ON p.id = ap.puesto_id
     LEFT JOIN core.regimen_laboral rl ON rl.id = p.regimen_laboral_id
     WHERE sv.id = $1
     ORDER BY ap.id DESC
     LIMIT 1`,
    [servidorId],
  );
  return calcularTopeDiasVacaciones(
    rows[0]?.dias_vacacion_anual ?? 30,
    rows[0]?.codigo_regimen ?? null,
  );
}
