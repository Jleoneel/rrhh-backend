import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  stream,
  listar,
  marcarLeida,
  marcarTodasLeidas,
} from "../controllers/firmaNotificacion.controller.js";

const router = Router();

// SSE — conexión en tiempo real
router.get("/stream", requireAuth, stream);

// CRUD notificaciones
router.get("/", requireAuth, listar);
router.patch("/leer-todas", requireAuth, marcarTodasLeidas);
router.patch("/:id/leer", requireAuth, marcarLeida);

export default router;