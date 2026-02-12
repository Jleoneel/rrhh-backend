// middlewares/upload.js
import multer from "multer";
import fs from "fs";
import path from "path";
import { pool } from "../db.js";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Función helper para obtener código_elaboracion
async function getCodigoElaboracion(accionId) {
  const { rows } = await pool.query(
    `SELECT codigo_elaboracion FROM core.accion_personal WHERE id = $1`,
    [accionId]
  );
  return rows[0]?.codigo_elaboracion || accionId;
}

export function uploadFirma() {
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const accionId = req.params.accionId;
        const codigo = await getCodigoElaboracion(accionId);
        
        const base = path.resolve(process.env.UPLOADS_DIR || "uploads");
        const dir = path.join(base, "acciones", codigo, "firmas");
        ensureDir(dir);
        cb(null, dir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      cb(null, `firmado_${ts}.pdf`);
    },
  });

  return multer({
    storage,
    fileFilter: (req, file, cb) => {
      if (file.mimetype !== "application/pdf") return cb(new Error("Solo PDF"));
      cb(null, true);
    },
    limits: { fileSize: 20 * 1024 * 1024 },
  });
}

export function uploadAnexo() {
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const accionId = req.params.accionId;
        const codigo = await getCodigoElaboracion(accionId);
        
        const base = path.resolve(process.env.UPLOADS_DIR || "uploads");
        const dir = path.join(base, "acciones", codigo, "anexos");
        ensureDir(dir);
        cb(null, dir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "");
      const baseName = path
        .basename(file.originalname || "archivo", ext)
        .replace(/[^\w.-]+/g, "_")
        .slice(0, 60);

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      cb(null, `${baseName}_${ts}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
  });
}