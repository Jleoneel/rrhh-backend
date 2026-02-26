// routes/distributivo.routes.js
import express from "express";
import multer from "multer";
import XLSX from "xlsx";
import { pool } from "../db.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function s(v) {
  return String(v ?? "").trim();
}

router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: "Falta el archivo .xlsx" });

  const client = await pool.connect();
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) return res.status(400).json({ ok: false, message: "El Excel no tiene filas" });

 const mapped = rows.map((r) => ({
  codigo_regimen_laboral: s(r["CÓDIGO RÉGIMEN LABORAL"]),
  regimen_laboral: s(r["RÉGIMEN LABORAL"]),

  // Nivel ocupacional (si tu staging tiene nivel_gestion o nivel_ocupacional)
  nivel_gestion: s(r["NIVEL OCUPACIONAL"]), // o cámbialo por el campo real de staging

  fecha_inicio: s(r["FECHA INICIO"]),
  fecha_fin: s(r["FECHA FIN"]),

  codigo_modalidad_laboral: s(r["CÓDIGO MODALIDAD LABORAL"]),
  modalidad_laboral: s(r["MODALIDAD LABORAL"]),

  partida_individual: s(r["PARTIDA INDIVIDUAL"]),
  estado_puesto: s(r["ESTADO DEL PUESTO"]),

  grado: s(r["GRADO"]),
  rmu_puesto: s(r["RMU PUESTO"]),

  codigo_escala_ocupacional: s(r["CÓDIGO ESCALA OCUPACIONAL"]),
  escala_ocupacional: s(r["ESCALA OCUPACIONAL"]),

  tipo_identificacion: s(r["TIPO IDENTIFICACIÓN"]),
  numero_identificacion: s(r["NÚMERO IDENTIFICACIÓN"]),
  nombres: s(r["NOMBRES"]),

  provincia: s(r["PROVINCIA"]),
  canton: s(r["CANTON"]),
  codigo_canton: s(r["CÓDIGO CANTON"]),

  codigo_denominacion_puesto: s(r["CÓDIGO DENOMINACIÓN PUESTO"]),
  denominacion_puesto: s(r["DENOMINACIÓN PUESTO"]),

  codigo_unidad_organica: s(r["CÓDIGO UNIDAD ORGÁNICA"]),
  unidad_organica: s(r["UNIDAD ORGÁNICA"]),

  estado_servidor: s(r["ESTADO DEL SERVIDOR"]),
}));
    await client.query("BEGIN");
    await client.query("TRUNCATE staging.stg_puestos_excel_raw");

    const insertSQL = `
      INSERT INTO staging.stg_puestos_excel_raw (
        codigo_regimen_laboral, regimen_laboral,
        codigo_modalidad_laboral, modalidad_laboral,
        partida_individual, estado_puesto,
        grado, rmu_puesto,
        codigo_unidad_organica, unidad_organica,
        codigo_denominacion_puesto, denominacion_puesto,
        codigo_escala_ocupacional, escala_ocupacional,
        tipo_identificacion, numero_identificacion, nombres,
        provincia, canton, codigo_canton,
        estado_servidor,
        fecha_inicio, fecha_fin
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23
      )
    `;

    for (const m of mapped) {
      await client.query(insertSQL, [
        m.codigo_regimen_laboral,
        m.regimen_laboral,
        m.codigo_modalidad_laboral,
        m.modalidad_laboral,
        m.partida_individual,
        m.estado_puesto,
        m.grado || null,
        m.rmu_puesto || null,
        m.codigo_unidad_organica,
        m.unidad_organica,
        m.codigo_denominacion_puesto,
        m.denominacion_puesto,
        m.codigo_escala_ocupacional,
        m.escala_ocupacional,
        m.tipo_identificacion,
        m.numero_identificacion,
        m.nombres,
        m.provincia,
        m.canton,
        m.codigo_canton,
        m.estado_servidor,
        m.fecha_inicio,
        m.fecha_fin,
      ]);
    }

    const { rows: syncRows } = await client.query("SELECT core.sync_distributivo() AS result");
    await client.query("COMMIT");

    return res.json({
      ok: true,
      message: "Importación completada",
      filas_excel: mapped.length,
      sync: syncRows[0].result,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ ok: false, message: "Error importando distributivo", error: err.message });
  } finally {
    client.release();
  }
});

export default router;