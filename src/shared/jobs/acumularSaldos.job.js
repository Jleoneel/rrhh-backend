import cron from "node-cron";
import { pool } from "../../db.js";
import { calcularTopeDiasVacaciones } from "../utils/regimenLaboral.js";

export function iniciarCronAcumularSaldos() {
  // Corre todos los días a las 00:01
  cron.schedule("1 0 * * *", async () => {
    console.log("[CRON] Verificando acumulación de saldos...");

    const hoy = new Date();
    const diaHoy = hoy.getDate();
    const mesHoy = hoy.getMonth() + 1;
    const anioHoy = hoy.getFullYear();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Buscar servidores cuyo día de ingreso coincide con hoy. El
      // incremento mensual ya NO es fijo: sale de servidor.dias_vacacion_anual
      // (ej. un auxiliar de enfermería que acumula más que el resto del
      // personal) → 30 por defecto si no está configurado (días/año × 8h ÷
      // 12 meses). El tope máximo acumulable tampoco es fijo: depende del
      // régimen laboral y de dias_vacacion_anual (ver calcularTopeDiasVacaciones).
      // DISTINCT ON + ORDER BY ap.id DESC: si hubiera más de una asignación
      // de puesto ACTIVA para el mismo servidor, se toma la más reciente
      // (mismo criterio que obtenerCodigoRegimen) para no duplicar filas.
      const { rows } = await client.query(
        `SELECT DISTINCT ON (sp.id)
    sp.id,
    sp.servidor_id,
    sp.horas_totales,
    sp.horas_usadas,
    sv.fecha_ingreso,
    COALESCE(sv.dias_vacacion_anual, 30) AS dias_vacacion_anual,
    rl.codigo AS codigo_regimen
  FROM core.saldo_permiso sp
  JOIN core.servidor sv ON sv.id = sp.servidor_id
  LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
  LEFT JOIN core.puesto p ON p.id = ap.puesto_id
  LEFT JOIN core.regimen_laboral rl ON rl.id = p.regimen_laboral_id
  WHERE
    sv.fecha_ingreso IS NOT NULL
    AND EXTRACT(DAY FROM sv.fecha_ingreso) = $1
    AND sv.estado_servidor IN ('ACTIVO', 'NOMBRAMIENTO PROVISIONAL')
  ORDER BY sp.id, ap.id DESC`,
        [diaHoy],
      );

      let acumulados = 0;

      for (const saldo of rows) {
        const horasTotales = parseFloat(saldo.horas_totales);
        const horasUsadas = parseFloat(saldo.horas_usadas);
        const disponibles = horasTotales - horasUsadas;
        const topeHoras =
          calcularTopeDiasVacaciones(
            saldo.dias_vacacion_anual,
            saldo.codigo_regimen,
          ) * 8;

        if (disponibles >= topeHoras) continue; // ya alcanzó su tope

        const incrementoMensual =
          Math.round(((saldo.dias_vacacion_anual * 8) / 12) * 100) / 100;
        const nuevasHoras =
          disponibles + incrementoMensual > topeHoras
            ? horasTotales + (topeHoras - disponibles)
            : horasTotales + incrementoMensual;

        await client.query(
          `
          UPDATE core.saldo_permiso
          SET horas_totales = $1, updated_at = NOW()
          WHERE id = $2
        `,
          [nuevasHoras, saldo.id],
        );

        await client.query(
          `
          INSERT INTO core.permiso_movimiento
            (servidor_id, horas, tipo, descripcion)
          VALUES ($1, $2, 'AJUSTE', $3)
        `,
          [
            saldo.servidor_id,
            incrementoMensual,
            `Acumulación mensual - ${diaHoy}/${mesHoy}/${anioHoy}`,
          ],
        );

        acumulados++;
      }

      await client.query("COMMIT");
      console.log(`[CRON] Saldos acumulados: ${acumulados} servidores`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[CRON] Error acumulando saldos:", err.message);
    } finally {
      client.release();
    }
  });

  console.log("[CRON] Job de acumulación de saldos iniciado");
}
