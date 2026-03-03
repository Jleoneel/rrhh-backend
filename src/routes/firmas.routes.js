import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  misFirmasPendientes,
  listarFirmasAccion,
  firmaPendienteAccion,
  eliminarFirma,
} from "../controllers/firmas.controller.js";

const router = Router();
router.get("/pendientes", requireAuth, misFirmasPendientes);
router.get("/acciones/:accionId", requireAuth, listarFirmasAccion);
router.get("/acciones/:accionId/pendiente", requireAuth, firmaPendienteAccion);
router.delete("/acciones/:accionId/firmas/:firmaId", requireAuth, eliminarFirma);

export default router;
