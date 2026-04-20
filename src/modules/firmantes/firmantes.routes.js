import { Router } from "express";
import {
  listFirmantesUath,
  createFirmanteUath,
  updateFirmante,
  resetPasswordFirmante,
} from "./firmantes.controller.js";

import { requireAuth, requireAdmin, requireFirmante } from "../../shared/middleware/auth.middleware.js";

const router = Router();

// SOLO ADMIN
router.get("/uath", requireAuth, requireFirmante, listFirmantesUath);
router.post("/uath", requireAuth,requireFirmante, createFirmanteUath);

router.put("/:id", requireAuth, requireFirmante, updateFirmante);
router.patch("/:id/reset-password", requireAuth, requireFirmante, resetPasswordFirmante);

export default router;
