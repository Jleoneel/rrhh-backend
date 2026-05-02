import "dotenv/config";
import fs from "fs";
import path from "path";
import { pool } from "../../db.js";
import { fileURLToPath } from "url";

async function run(dias = 30) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "../../");
  const uploadsBase = path.resolve(projectRoot, process.env.UPLOADS_DIR || "uploads");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    //Obtener candidatos a purga
    const r = await client.query(
      `SELECT id, archivo_path FROM core.docs_parciales_para_purgar($1);`,
      [dias],
    );

    if (r.rowCount === 0) {
      await client.query("COMMIT");
      return;
    }

    const ids = r.rows.map((x) => x.id);

    //Borrar archivos físicos
    let borradosFisicos = 0;
    for (const row of r.rows) {
      const rel = String(row.archivo_path || "").replace(/^\/uploads\//, "");
      const abs = path.join(uploadsBase, rel);
      const exists = fs.existsSync(abs);

      if (exists) {
        fs.unlinkSync(abs);
        borradosFisicos++;
      }
    }

    //Desvincular firmas (documento_id → NULL)
    const desvinculadas = await client.query(
      `UPDATE core.accion_firma
       SET documento_id = NULL
       WHERE documento_id = ANY($1::uuid[])
       RETURNING id;`,
      [ids],
    );
    console.log("Firmas desvinculadas:", desvinculadas.rowCount);

    //Borrar documentos parciales de la BD
    await client.query(
      `DELETE FROM core.accion_documento WHERE id = ANY($1::uuid[]);`,
      [ids],
    );

    await client.query("COMMIT");

    console.log(
      `OK. Físicos: ${borradosFisicos} | BD: ${r.rowCount} | Firmas desvinculadas: ${desvinculadas.rowCount}`,
    );
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("PURGE FAIL:", e);
  } finally {
    client.release();
  }
}

run(30);