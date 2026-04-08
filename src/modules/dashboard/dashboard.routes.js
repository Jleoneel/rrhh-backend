import { Router } from "express";
import { pool } from "../../db.js";
import { requireAuth } from "../../shared/middleware/auth.middleware.js";

const router = Router();

/**
 * GET /api/dashboard/acciones-resumen
 * Devuelve conteo de acciones por estado
 */
router.get("/acciones-resumen", requireAuth, async (req, res) => {
  try {
    const sql = `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE estado = 'BORRADOR') AS borrador,
        COUNT(*) FILTER (WHERE estado = 'EN_FIRMA') AS en_revision,
        COUNT(*) FILTER (WHERE estado = 'APROBADO') AS aprobadas,
        COUNT(*) FILTER (WHERE estado = 'INSUBSISTENTE') AS rechazadas
      FROM core.accion_personal;
    `;

    const { rows } = await pool.query(sql);

    // rows[0] porque es una sola fila
    res.json(rows[0]);
  } catch (error) {
    console.error("Error dashboard acciones:", error);
    res.status(500).json({
      message: "Error obteniendo resumen del dashboard",
      error: error.message,
    });
  }
});

export default router;
