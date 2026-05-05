import "dotenv/config";
import fs from "fs";
import path from "path";
import { pool } from "../../db.js";
import cron from "node-cron";

const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");

const eliminarArchivo = (rutaRelativa) => {
  if (!rutaRelativa) return;
  const abs = path.resolve(uploadsBase, rutaRelativa.replace(/^\/uploads\//, ""));
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
    console.log(`[PURGE] Eliminado: ${abs}`);
  }
};

const eliminarCarpetaVacia = (absPath) => {
  try {
    if (fs.existsSync(absPath) && fs.readdirSync(absPath).length === 0) {
      fs.rmdirSync(absPath);
      console.log(`[PURGE] Carpeta eliminada: ${absPath}`);
    }
  } catch (_) {}
};

export const purgarFirmasIntermedias = async () => {
  console.log("[PURGE] Iniciando purga de firmas intermedias...");

  const client = await pool.connect();
  try {
    // ─── PURGA ACCIONES ───────────────────────────────────────
    const { rows } = await client.query(`
      SELECT id, codigo_elaboracion,
             archivo_elabora, archivo_registra,
             archivo_revisa, archivo_aprueba_th,
             archivo_aprueba_autoridad
      FROM core.accion_personal
      WHERE estado = 'APROBADO'
        AND fecha_elaboracion < NOW() - INTERVAL '30 days'
        AND archivo_aprueba_autoridad IS NOT NULL
        AND (
          archivo_elabora IS NOT NULL OR
          archivo_registra IS NOT NULL OR
          archivo_revisa IS NOT NULL OR
          archivo_aprueba_th IS NOT NULL
        )
    `);

    let purgados = 0;
    for (const accion of rows) {
      eliminarArchivo(accion.archivo_elabora);
      eliminarArchivo(accion.archivo_registra);
      eliminarArchivo(accion.archivo_revisa);
      eliminarArchivo(accion.archivo_aprueba_th);

      await client.query(`
        UPDATE core.accion_personal
        SET archivo_elabora = NULL, archivo_registra = NULL,
            archivo_revisa = NULL, archivo_aprueba_th = NULL
        WHERE id = $1
      `, [accion.id]);

      // Eliminar carpetas vacías de esta acción
      const baseAccion = path.resolve(uploadsBase, "acciones", accion.codigo_elaboracion, "firmas");
      ["elabora", "registra_controla", "revisa", "aprueba_th"].forEach(rol => {
        eliminarCarpetaVacia(path.join(baseAccion, rol));
      });

      purgados++;
      console.log(`[PURGE] Acción ${accion.codigo_elaboracion} limpiada`);
    }
    console.log(`[PURGE] Acciones procesadas: ${purgados}`);

    // ─── PURGA VACACIONES ─────────────────────────────────────
    const { rows: vacaciones } = await client.query(`
      SELECT id, archivo_jefe, archivo_superior, archivo_uath
      FROM core.vacacion_solicitud
      WHERE estado = 'APROBADO'
        AND fecha_respuesta_uath < NOW() - INTERVAL '0 days'
        AND archivo_uath IS NOT NULL
        AND (
          archivo_jefe IS NOT NULL OR
          archivo_superior IS NOT NULL
        )
    `);

    let purgadosVac = 0;
    for (const vac of vacaciones) {
      eliminarArchivo(vac.archivo_jefe);
      eliminarArchivo(vac.archivo_superior);

      await client.query(`
        UPDATE core.vacacion_solicitud
        SET archivo_jefe = NULL, archivo_superior = NULL
        WHERE id = $1
      `, [vac.id]);

      // Eliminar carpetas vacías de esta vacación
      const baseVac = path.resolve(uploadsBase, "vacaciones", `solicitud_${vac.id}`);
      ["jefe", "superior"].forEach(tipo => {
        eliminarCarpetaVacia(path.join(baseVac, tipo));
      });

      purgadosVac++;
      console.log(`[PURGE] Vacación ${vac.id} limpiada`);
    }
    console.log(`[PURGE] Vacaciones procesadas: ${purgadosVac}`);

  } catch (err) {
    console.error("[PURGE] Error:", err.message);
  } finally {
    client.release();
  }
};

// Corre todos los días a las 02:00
cron.schedule("0 2 * * *", () => {
  purgarFirmasIntermedias();
});

console.log("[PURGE] Job de purga de firmas iniciado");