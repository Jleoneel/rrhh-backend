import { Router } from "express";
import { generarPdfVacacion } from "../vacaciones/vacacionesPdf.controller.js";
import { requireAuth, requireFirmante } from "../../../../shared/middleware/auth.middleware.js";

// Importar módulos
import vacSolicitudesServidorRoutes from "./vac-solicitudes-servidor.routes.js";
import vacSolicitudesFirmanteRoutes from "./vac-solicitudes-firmante.routes.js";
import vacBandejaRoutes from "./vac-bandeja.routes.js";
import vacFirmasRoutes from "./vac-firmas.routes.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════
// RUTAS ESPECÍFICAS PRIMERO (antes de /:id)
// ═══════════════════════════════════════════════════════════════
router.use(vacSolicitudesServidorRoutes);
router.use(vacSolicitudesFirmanteRoutes);
router.use(vacBandejaRoutes);

// PDF base
router.get("/:id/pdf-vacacion", generarPdfVacacion);

// ═══════════════════════════════════════════════════════════════
// RUTAS CON PARÁMETROS
// ═══════════════════════════════════════════════════════════════
router.use(vacFirmasRoutes);

export default router;