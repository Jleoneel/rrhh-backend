import { Router } from "express";
import { generarPdfVacacion } from "../vacaciones/vacacionesPdf.controller.js";
import { requireAuth } from "../../../shared/middleware/auth.middleware.js";

// Importar módulos
import vacSolicitudesServidorRoutes from "./vac-solicitudes-servidor.routes.js";
import vacSolicitudesFirmanteRoutes from "./vac-solicitudes-firmante.routes.js";
import vacBandejaRoutes from "./vac-bandeja.routes.js";
import vacFirmasRoutes from "./vac-firmas.routes.js";

const router = Router();

// RUTAS ESPECÍFICAS PRIMERO (
router.use(vacSolicitudesServidorRoutes);
router.use(vacSolicitudesFirmanteRoutes);
router.use(vacBandejaRoutes);

// PDF base — antes sin autenticación (cualquiera podía descargar el PDF
// de cualquier solicitud con solo adivinar el id, que es un entero
// secuencial). requireAuth + verificación de dueño dentro del propio
// controlador (generarPdfVacacion).
router.get("/:id/pdf-vacacion", requireAuth, generarPdfVacacion);

// RUTAS CON PARÁMETROS
router.use(vacFirmasRoutes);

export default router;