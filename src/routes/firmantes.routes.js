import { Router } from "express";
import {
  listFirmantesUath,
  createFirmanteUath,
  updateFirmante,
  resetPasswordFirmante,
} from "../controllers/firmantes.controller.js";

import { requireAuth, requireAdmin } from "../middleware/auth.middleware.js";

const router = Router();

// SOLO ADMIN
router.get("/uath", requireAuth, requireAdmin, listFirmantesUath);
router.post("/uath", requireAuth, requireAdmin, createFirmanteUath);

router.put("/:id", requireAuth, requireAdmin, updateFirmante);
router.patch("/:id/reset-password", requireAuth, requireAdmin, resetPasswordFirmante);

export default router;
