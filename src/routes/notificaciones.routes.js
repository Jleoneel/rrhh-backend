import { Router } from "express";
import { registrarNotificacion, consultarNotificacion } from "../controllers/notificaciones.controller.js";

const router = Router();

router.post("/", registrarNotificacion);
router.get("/:accionId", consultarNotificacion);

export default router;
