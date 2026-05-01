import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { pool } from "../../db.js";
import {
  requireAuth,
  requireFirmante,
} from "../../shared/middleware/auth.middleware.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const excelFechaADate = (numeroExcel) => {
  if (!numeroExcel) return null;
  const fecha = XLSX.SSF.parse_date_code(numeroExcel);
  if (!fecha) return null;
  return `${fecha.y}-${String(fecha.m).padStart(2, "0")}-${String(fecha.d).padStart(2, "0")}`;
};

router.post(
  "/import-posicional",
  requireAuth,
  requireFirmante,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Falta el archivo" });

    const client = await pool.connect();
    try {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      // Headers en fila 4, datos desde fila 6
      const DATA_START = 6;
      const COL_CEDULA = 4;
      const COL_EMAIL_INST = 19;
      const COL_FECHA_INGRESO = 16;

      let actualizados = 0;
      let sinEmail = 0;
      let noEncontrados = 0;

      await client.query("BEGIN");

      for (let i = DATA_START; i < filas.length; i++) {
        const fila = filas[i];
        const cedula = String(fila[COL_CEDULA] || "").trim();
        const emailInst = String(fila[COL_EMAIL_INST] || "")
          .trim()
          .toLowerCase();
        const fechaExcel = fila[COL_FECHA_INGRESO];

        if (!cedula) continue;

        if (!emailInst || !emailInst.includes("@")) {
          sinEmail++;
          continue;
        }

        const fechaIngreso =
          typeof fechaExcel === "number" ? excelFechaADate(fechaExcel) : null;

        // Actualizar servidor.email
        const svR = await client.query(
          `UPDATE core.servidor 
            SET email = $1, fecha_ingreso = $2 
                WHERE numero_identificacion = $3 
            RETURNING id`,
          [emailInst, fechaIngreso, cedula],
        );

        // Actualizar firmante.email
        await client.query(
          `UPDATE core.firmante SET email = $1 WHERE numero_identificacion = $2`,
          [emailInst, cedula],
        );

        // Actualizar saldo_permiso.fecha_ingreso
        if (fechaIngreso) {
          await client.query(
            `UPDATE core.servidor SET email = $1, fecha_ingreso = $2 WHERE numero_identificacion = $3`,
            [emailInst, fechaIngreso, cedula],
          );
        }

        if (svR.rows.length > 0) actualizados++;
        else noEncontrados++;
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        message: `Importación completada`,
        actualizados,
        sinEmail,
        noEncontrados,
        total: filas.length - DATA_START,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error importando", error: err.message });
    } finally {
      client.release();
    }
  },
);

export default router;
