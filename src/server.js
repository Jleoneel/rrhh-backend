import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

import accionesRoutes from "./modules/acciones/acciones.routes.js";
import servidoresRoutes from "./modules/servidores/servidores.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import firmasRoutes from "./modules/firmas/firmas.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import tiposAcccionRoutes from "./modules/acciones/tiposAcccion.routes.js";
import catalogosRoutes from "./modules/catalogos/catalogos.routes.js";
import accionesPdfRoutes from "./modules/acciones/accionesPdf.routes.js";
import firmantesRoutes from "./modules/firmantes/firmantes.routes.js";
import notificacionesRoutes from "./modules/notificaciones/notificaciones.routes.js";
import distributivoRoutes from "./modules/distributivo/distributivo.routes.js";
import firmaNotificacionRoutes from "./modules/firmas/firmaNotificacion.routes.js";

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());

// Crear carpeta uploads si no existe
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Exponer archivos estáticos (para descargar PDFs luego si quieres)
app.use("/uploads", express.static(uploadsDir));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/acciones", accionesRoutes);
app.use("/api/servidores", servidoresRoutes);
app.use("/api/firmas", firmasRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/tipos-accion", tiposAcccionRoutes);
app.use("/api/catalogos", catalogosRoutes);
app.use("/api", accionesPdfRoutes);
app.use("/api/notificaciones", notificacionesRoutes);
app.use("/api/firmantes", firmantesRoutes);
app.use("/api/distributivo", distributivoRoutes);
app.use("/api/firma-notificaciones", firmaNotificacionRoutes);


const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
