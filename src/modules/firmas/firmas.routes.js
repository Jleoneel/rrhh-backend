import { Router } from "express";
import {
  requireAuth,
  requireFirmante,
} from "../../shared/middleware/auth.middleware.js";
import {
  misFirmasPendientes,
  listarFirmasAccion,
  firmaPendienteAccion,
  eliminarFirma,
} from "./firmas.controller.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { pool } from "../../db.js";

const router = Router();
router.get("/pendientes", requireAuth, misFirmasPendientes);
router.get("/acciones/:accionId", requireAuth, listarFirmasAccion);
router.get("/acciones/:accionId/pendiente", requireAuth, firmaPendienteAccion);
router.delete(
  "/acciones/:accionId/firmas/:firmaId",
  requireAuth,
  eliminarFirma,
);

// ─── RUTAS NUEVAS (certificado p12) ───────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve(
      process.env.UPLOADS_DIR || "uploads",
      "certificados",
    );
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const { firmante_id } = req.user;
    cb(null, `${firmante_id}.p12`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.originalname.endsWith(".p12")) {
      return cb(new Error("Solo se permiten archivos .p12"));
    }
    cb(null, true);
  },
});

// POST /api/firmas/subir-p12
router.post(
  "/subir-p12",
  requireAuth,
  requireFirmante,
  upload.single("file"),
  async (req, res) => {
    const { firmante_id } = req.user;
    if (!req.file)
      return res.status(400).json({ message: "Archivo .p12 requerido" });

    const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
    const rel = path.relative(uploadsBase, req.file.path).replaceAll("\\", "/");
    const p12Path = `/uploads/${rel}`;

    try {
      await pool.query(
        `UPDATE core.firmante SET p12_path = $1, p12_activo = true WHERE id = $2`,
        [p12Path, firmante_id],
      );
      return res.json({
        message: "Certificado subido correctamente",
        p12_path: p12Path,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error guardando certificado", error: err.message });
    }
  },
);

// GET /api/firmas/mi-certificado
router.get(
  "/mi-certificado",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    try {
      const { rows } = await pool.query(
        `SELECT p12_path, p12_activo FROM core.firmante WHERE id = $1`,
        [firmante_id],
      );
      return res.json({
        tiene_certificado: !!rows[0]?.p12_path,
        p12_activo: rows[0]?.p12_activo || false,
      });
    } catch (err) {
      return res.status(500).json({ message: "Error", error: err.message });
    }
  },
);

export default router;
