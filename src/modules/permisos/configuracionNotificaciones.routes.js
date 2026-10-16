import { Router } from "express";
import { pool } from "../../db.js";
import { requireAuth } from "../../shared/middleware/auth.middleware.js";
import { requireCargo } from "../../shared/middleware/requireCargo.middleware.js";
import { CARGO_IDS } from "../../shared/constants/cargos.js";

const router = Router();

function limpiarCorreo(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

// GET /api/permisos/configuracion-notificaciones
router.get(
  "/configuracion-notificaciones",
  requireAuth,
  requireCargo([CARGO_IDS.ASISTENTE_UATH]),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT email_notificacion_permisos, email_notificacion_vacaciones
         FROM core.configuracion_notificaciones WHERE id = 1`,
      );
      return res.json(
        rows[0] || {
          email_notificacion_permisos: null,
          email_notificacion_vacaciones: null,
        },
      );
    } catch (err) {
      console.error("Error obteniendo configuración de notificaciones:", err);
      return res
        .status(500)
        .json({ message: "Error obteniendo configuración de notificaciones" });
    }
  },
);

// PUT /api/permisos/configuracion-notificaciones
router.put(
  "/configuracion-notificaciones",
  requireAuth,
  requireCargo([CARGO_IDS.ASISTENTE_UATH]),
  async (req, res) => {
    const emailPermisos = limpiarCorreo(req.body?.email_notificacion_permisos);
    const emailVacaciones = limpiarCorreo(req.body?.email_notificacion_vacaciones);

    if (emailPermisos && !emailPermisos.includes("@")) {
      return res.status(400).json({ message: "El correo de permisos no es válido" });
    }
    if (emailVacaciones && !emailVacaciones.includes("@")) {
      return res.status(400).json({ message: "El correo de vacaciones no es válido" });
    }

    try {
      const { rows } = await pool.query(
        `UPDATE core.configuracion_notificaciones
         SET email_notificacion_permisos = $1,
             email_notificacion_vacaciones = $2,
             updated_at = NOW()
         WHERE id = 1
         RETURNING email_notificacion_permisos, email_notificacion_vacaciones`,
        [emailPermisos, emailVacaciones],
      );
      return res.json(rows[0]);
    } catch (err) {
      console.error("Error actualizando configuración de notificaciones:", err);
      return res
        .status(500)
        .json({ message: "Error actualizando configuración de notificaciones" });
    }
  },
);

export default router;
