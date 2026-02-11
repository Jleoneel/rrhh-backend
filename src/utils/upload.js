import multer from "multer";
import fs from "fs";
import path from "path";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function uploadFirma() {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const accionId = req.params.accionId;
      const base = path.resolve(process.env.UPLOADS_DIR || "uploads");
      const dir = path.join(base, "acciones", accionId, "firmas");
      ensureDir(dir);
      cb(null, dir);
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
    destination: (req, file, cb) => {
      const accionId = req.params.accionId;
      const base = path.resolve(process.env.UPLOADS_DIR || "uploads");
      const dir = path.join(base, "acciones", accionId, "anexos");
      ensureDir(dir);
      cb(null, dir);
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
