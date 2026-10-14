import { Router } from "express";
import { pool } from "../../db.js";
import { requireAuth } from "../../shared/middleware/auth.middleware.js";

const router = Router();

// GET /api/permisos/tipos
router.get("/tipos", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre FROM core.permiso_tipo WHERE activo = true ORDER BY nombre`,
    );
    return res.json(rows);
  } catch (err) {
    console.error("Error obteniendo tipos:", err);
    return res.status(500).json({ message: "Error obteniendo tipos" });
  }
});

// GET /api/permisos/firmantes-disponibles
router.get("/firmantes-disponibles", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        f.id, 
        f.nombre, 
        c.nombre as cargo_nombre
      FROM core.firmante f
      LEFT JOIN core.cargo c ON c.id = f.cargo_id
      WHERE f.activo = true
      ORDER BY f.nombre ASC
    `);
    return res.json(rows);
  } catch (err) {
    console.error("Error obteniendo firmantes:", err);
    return res.status(500).json({
      message: "Error obteniendo firmantes",
    });
  }
});

export default router;