import { Router } from "express";
import {
  listFirmantesUath,
  createFirmanteUath,
  updateFirmante,
  resetPasswordFirmante,
} from "./firmantes.controller.js";

import { requireAuth, requireAdmin, requireFirmante } from "../../shared/middleware/auth.middleware.js";
import { requireCargo } from "../../shared/middleware/requireCargo.middleware.js";
import { CARGO_IDS } from "../../shared/constants/cargos.js";

const router = Router();

// SOLO ADMIN
router.get("/uath", requireAuth, requireFirmante, listFirmantesUath);
router.post("/uath", requireAuth,requireFirmante, createFirmanteUath);

router.put("/:id", requireAuth, requireFirmante, updateFirmante);
// Antes solo pedía requireFirmante: cualquier firmante (cualquier jefe de
// área, gerente, etc.), no solo UATH, podía resetear la contraseña de
// cualquier otro firmante. Restringido a los mismos cargos que ya ven el
// botón "Resetear contraseña" en el frontend (Sidebar.jsx: esAsistenteUATH
// || esResponsableUATH || esAdmin, este último vía bypass de requireCargo).
router.patch(
  "/:id/reset-password",
  requireAuth,
  requireCargo([CARGO_IDS.ASISTENTE_UATH, CARGO_IDS.RESPONSABLE_UATH]),
  resetPasswordFirmante,
);

export default router;
