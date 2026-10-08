import cron from "node-cron";
import { pool } from "../../db.js";

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
      // incremento mensual ya NO es fijo: sale de
      // unidad_organica.dias_vacacion_anual de su puesto ACTIVO (días/año
      // × 8h ÷ 12 meses) — una unidad sin configurar explícitamente usa el
      // default de esa columna (30 días/año = 20h/mes, el valor fijo que
      // tenía todo el mundo antes de este cambio). Si el servidor no tiene
      // asignación activa (no debería pasar, pero por seguridad), cae al
      // mismo default de 30 vía COALESCE.
      const { rows } = await client.query(
        `SELECT
    sp.id,
    sp.servidor_id,
    sp.horas_totales,
    sp.horas_usadas,
    sv.fecha_ingreso,
    COALESCE(u.dias_vacacion_anual, 30) AS dias_vacacion_anual
  FROM core.saldo_permiso sp
  JOIN core.servidor sv ON sv.id = sp.servidor_id
  LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
  LEFT JOIN core.puesto p ON p.id = ap.puesto_id
  LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
  WHERE
    sv.fecha_ingreso IS NOT NULL
    AND EXTRACT(DAY FROM sv.fecha_ingreso) = $1
    AND sv.estado_servidor IN ('ACTIVO', 'NOMBRAMIENTO PROVISIONAL')
    AND (sp.horas_totales - sp.horas_usadas) < 480`,
        [diaHoy],
      );

      let acumulados = 0;

      for (const saldo of rows) {
        const horasTotales = parseFloat(saldo.horas_totales);
        const horasUsadas = parseFloat(saldo.horas_usadas);
        const disponibles = horasTotales - horasUsadas;
        const incrementoMensual =
          Math.round(((saldo.dias_vacacion_anual * 8) / 12) * 100) / 100;
        const nuevasHoras =
          disponibles + incrementoMensual > 480
            ? horasTotales + (480 - disponibles)
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
