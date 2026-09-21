import multer from "multer";
import path from "path";
import fs from "fs";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { id } = req.params;
    const url = req.path;
    let subdir = "base";
    if (url.includes("subir-firma-jefe")) subdir = "jefe";
    else if (url.includes("subir-firma-superior")) subdir = "superior";
    else if (url.includes("subir-firma-uath")) subdir = "uath";

    const dir = path.resolve(
      process.env.UPLOADS_DIR || "uploads",
      "vacaciones",
      `solicitud_${id}`,
      subdir,
    );
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `firmado_${Date.now()}.pdf`);
  },
});

export const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Solo se permiten archivos PDF"));
    }
    cb(null, true);
  },
});