import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { pool } from "../../db.js";
import {
  requireAuth,
  requireFirmante,
} from "../../shared/middleware/auth.middleware.js";
import { conManejoErrorMulter } from "../../shared/middleware/manejarErrorMulter.middleware.js";

const router = Router();
// memoryStorage carga el archivo entero en RAM antes de validar nada —
// sin límite, cualquier firmante (requireFirmante) podía tumbar el
// proceso mandando un archivo gigante. 10MB es generoso para un Excel
// de texto plano de ~1000 filas.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const excelFechaADate = (numeroExcel) => {
  if (!numeroExcel) return null;
  const fecha = XLSX.SSF.parse_date_code(numeroExcel);
  if (!fecha) return null;
  return `${fecha.y}-${String(fecha.m).padStart(2, "0")}-${String(fecha.d).padStart(2, "0")}`;
};

const normalizarEncabezado = (valor) => String(valor || "").toUpperCase().trim();

// Ubica una columna por el TEXTO de su encabezado en vez de un número de
// columna fijo. El Ministerio cambia el formato del Excel posicional sin
// avisar (ej. nov/2026: quitaron la columna "EOD" y todo lo siguiente se
// corrió una posición) — con índices fijos, el import sigue "funcionando"
// sin errores pero leyendo las columnas equivocadas en silencio (pasó: 0
// actualizados porque "cédula" terminaba leyendo la columna de nombres).
// Todos los patrones deben aparecer en el encabezado para considerarlo un
// match (ej. "CORREO" + "INSTITU" evita confundir el correo institucional
// con el personal).
function encontrarColumna(filaEncabezados, ...patrones) {
  for (let i = 0; i < filaEncabezados.length; i++) {
    const texto = normalizarEncabezado(filaEncabezados[i]);
    if (patrones.every((p) => texto.includes(p))) return i;
  }
  return -1;
}

// Busca la fila de encabezados por contenido (contiene "CEDULA"), no por
// número de fila fijo — el formato nuevo corrió los encabezados una fila
// hacia abajo respecto al anterior.
function encontrarFilaEncabezados(filas) {
  const limite = Math.min(filas.length, 15);
  for (let r = 0; r < limite; r++) {
    if (encontrarColumna(filas[r], "CEDULA") !== -1) return r;
  }
  return -1;
}

router.post(
  "/import-posicional",
  requireAuth,
  requireFirmante,
  conManejoErrorMulter(upload.single("file")),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Falta el archivo" });

    const client = await pool.connect();
    try {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      const filaEncabezados = encontrarFilaEncabezados(filas);
      if (filaEncabezados === -1) {
        return res.status(400).json({
          message:
            "No se encontró la columna 'CEDULA' en el Excel. Verifica que sea el formato correcto del posicional.",
        });
      }

      const encabezados = filas[filaEncabezados];
      const COL_CEDULA = encontrarColumna(encabezados, "CEDULA");
      const COL_EMAIL_INST = encontrarColumna(encabezados, "CORREO", "INSTITU");
      const COL_FECHA_INGRESO = encontrarColumna(encabezados, "FECHA INGRESO");

      if (COL_CEDULA === -1 || COL_EMAIL_INST === -1 || COL_FECHA_INGRESO === -1) {
        return res.status(400).json({
          message:
            "No se encontraron todas las columnas necesarias en el Excel " +
            `(cédula: ${COL_CEDULA !== -1 ? "OK" : "falta"}, ` +
            `correo institucional: ${COL_EMAIL_INST !== -1 ? "OK" : "falta"}, ` +
            `fecha de ingreso: ${COL_FECHA_INGRESO !== -1 ? "OK" : "falta"}).`,
        });
      }

      // Los datos empiezan justo después del encabezado — puede haber una
      // fila en blanco de por medio, pero el chequeo de "!cedula" más
      // abajo ya la salta sin necesidad de un offset fijo.
      const DATA_START = filaEncabezados + 1;

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
      console.error("Error importando distributivo posicional:", err);
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error importando" });
    } finally {
      client.release();
    }
  },
);

export default router;
