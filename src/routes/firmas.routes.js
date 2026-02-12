import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  misFirmasPendientes,
  listarFirmasAccion,
  firmaPendienteAccion,
} from "../controllers/firmas.controller.js";

const router = Router();

// 1) firmas pendientes del usuario logueado (por cargo)
router.get("/pendientes", requireAuth, misFirmasPendientes);

// 2) firmas de una acción (timeline completo)
router.get("/acciones/:accionId", requireAuth, listarFirmasAccion);

// 3) firma pendiente actual de una acción
router.get("/acciones/:accionId/pendiente", requireAuth, firmaPendienteAccion);

export default router;
