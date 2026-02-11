import { Router } from "express";
import { generarPdfAccion } from "../controllers/accionesPdf.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.get(
  "/acciones/:id/pdf",
  requireAuth,
  generarPdfAccion
);

export default router;
