import { Router } from "express";
import { generarPdfAccion } from "./accionesPdf.controller.js";
import { requireAuth } from "../../shared/middleware/auth.middleware.js";

const router = Router();

router.get(
  "/acciones/:id/pdf",
  requireAuth,
  generarPdfAccion
);

export default router;
