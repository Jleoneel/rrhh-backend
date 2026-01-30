import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { misFirmasPendientes } from "../controllers/firmas.controller.js";

const router = Router();

router.get("/pendientes", requireAuth, misFirmasPendientes);

export default router;
