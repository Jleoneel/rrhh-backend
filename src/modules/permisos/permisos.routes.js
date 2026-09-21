import { Router } from "express";

// Importar módulos
import usuariosServidorRoutes from "./usuarios-servidor.routes.js";
import saldosRoutes from "./saldos.routes.js";
import jefesRoutes from "./jefes.routes.js";
import solicitudesServidorRoutes from "./solicitudes-servidor.routes.js";
import solicitudesFirmanteRoutes from "./solicitudes-firmante.routes.js";
import bandejaRoutes from "./bandeja.routes.js";
import catalogosRoutes from "./catalogos.routes.js";
import notificacionesPermisoRoutes from "./notificaciones-permiso.routes.js";
import reporteRoutes from "./reporte.routes.js";
import vacacionesRoutes from "./vacaciones/vacaciones.routes.js";

const router = Router();

// Montar módulos
router.use(usuariosServidorRoutes);
router.use(saldosRoutes);
router.use(jefesRoutes);
router.use(solicitudesServidorRoutes);
router.use(solicitudesFirmanteRoutes);
router.use(bandejaRoutes);
router.use(catalogosRoutes);
router.use("/notificaciones", notificacionesPermisoRoutes);
router.use(reporteRoutes);
router.use(vacacionesRoutes);

export default router;