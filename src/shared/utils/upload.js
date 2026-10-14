import multer from "multer";
import fs from "fs";
import path from "path";
import { pool } from "../../db.js";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// El frontend ya anuncia estos tipos en el accept= del <input> (AnexosModal.jsx)
// pero eso es solo una sugerencia de UI — nada impedía subir cualquier otro
// archivo (ej. un .html o .svg con script embebido, que luego /uploads sirve
// con su Content-Type real, renderizable inline en el navegador = XSS
// almacenado). Esta es la validación real, del lado del servidor.
const MIMETYPES_ANEXO_PERMITIDOS = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

function filtroAnexo(req, file, cb) {
  if (!MIMETYPES_ANEXO_PERMITIDOS.has(file.mimetype)) {
    return cb(new Error("Solo se permiten archivos PDF, Word (doc/docx), JPG o PNG"));
  }
  cb(null, true);
}

// Función helper para obtener código_elaboracion
async function getCodigoElaboracion(accionId) {
  const { rows } = await pool.query(
    `SELECT codigo_elaboracion FROM core.accion_personal WHERE id = $1`,
    [accionId]
  );
  return rows[0]?.codigo_elaboracion || accionId;
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
    fileFilter: filtroAnexo,
    limits: { fileSize: 20 * 1024 * 1024 },
  });
}