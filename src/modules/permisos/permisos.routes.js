import { Router } from "express";
import { requireAuth, requireFirmante } from "../../shared/middleware/auth.middleware.js";

// Importar módulos
import usuariosServidorRoutes from "./modules/usuarios-servidor.routes.js";
import saldosRoutes from "./modules/saldos.routes.js";
import jefesRoutes from "./modules/jefes.routes.js";
import solicitudesServidorRoutes from "./modules/solicitudes-servidor.routes.js";
import solicitudesFirmanteRoutes from "./modules/solicitudes-firmante.routes.js";
import bandejaRoutes from "./modules/bandeja.routes.js";
import catalogosRoutes from "./modules/catalogos.routes.js";

const router = Router();

// Montar módulos
router.use(usuariosServidorRoutes);
router.use(saldosRoutes);
router.use(jefesRoutes);
router.use(solicitudesServidorRoutes);
router.use(solicitudesFirmanteRoutes);
router.use(bandejaRoutes);
router.use(catalogosRoutes);

// Endpoint adicional que no encaja en los módulos anteriores
router.get("/firmantes-disponibles", requireAuth, requireFirmante, async (req, res) => {
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
    return res.status(500).json({ 
      message: "Error obteniendo firmantes", 
      error: err.message 
    });
  }
});

export default router;