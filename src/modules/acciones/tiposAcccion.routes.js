import { Router } from "express";
import { pool } from "../../db.js";
import { requireAuth } from "../../shared/middleware/auth.middleware.js";

const router = Router();

// GET /api/tipos-accion
router.get("/", requireAuth, async (req, res) => {
  try {
    const sql = `
      SELECT
        id,
        nombre,
        requiere_propuesta
      FROM core.tipo_accion
      WHERE activo = true
      ORDER BY nombre;
    `;

    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (error) {
    console.error("Error listando tipos de acción:", error);
    res.status(500).json({
      message: "Error obteniendo tipos de acción",
      error: error.message,
    });
  }
});

export default router;
