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

      // Buscar servidores cuyo día de ingreso coincide con hoy
      const { rows } = await client.query(`
        SELECT 
          sp.id,
          sp.servidor_id,
          sp.horas_totales,
          sp.horas_usadas,
          sp.fecha_ingreso
        FROM core.saldo_permiso sp
        JOIN core.servidor sv ON sv.id = sp.servidor_id
        WHERE 
          EXTRACT(DAY FROM sp.fecha_ingreso) = $1
          AND sv.estado_servidor IN ('ACTIVO', 'NOMBRAMIENTO PROVISIONAL')
          AND (sp.horas_totales - sp.horas_usadas) < 480
      `, [diaHoy]);

      let acumulados = 0;

      for (const saldo of rows) {
        const nuevasHoras = Math.min(
          saldo.horas_totales + 20, 
          saldo.horas_usadas + 480
        );

        await client.query(`
          UPDATE core.saldo_permiso
          SET horas_totales = $1, updated_at = NOW()
          WHERE id = $2
        `, [nuevasHoras, saldo.id]);

        await client.query(`
          INSERT INTO core.permiso_movimiento
            (servidor_id, horas, tipo, descripcion)
          VALUES ($1, 20, 'AJUSTE', $2)
        `, [
          saldo.servidor_id,
          `Acumulación mensual - ${diaHoy}/${mesHoy}/${anioHoy}`
        ]);

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