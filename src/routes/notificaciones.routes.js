import { Router } from "express";
import { registrarNotificacion, consultarNotificacion } from "../controllers/notificaciones.controller.js";

const router = Router();

// Registrar notificación
router.post("/", registrarNotificacion);

// Consultar notificación por acción
router.get("/:accionId", consultarNotificacion);

export default router;
