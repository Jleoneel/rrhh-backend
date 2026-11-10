import { Router } from "express";
import { generarPdfAccion } from "./accionesPdf.controller.js";
import { requireAuth } from "../../shared/middleware/auth.middleware.js";
import { requireAccesoAccion } from "./acciones.routes.js";

const router = Router();

// Antes solo exigía requireAuth: cualquier empleado con usuario podía
// descargar el PDF legal (RMU, motivo, declaración jurada) de cualquier
// otra Acción de Personal adivinando el id. Mismo guard que ya protege el
// detalle/anexos de la acción.
router.get(
  "/acciones/:id/pdf",
  requireAuth,
  requireAccesoAccion,
  generarPdfAccion
);

export default router;
