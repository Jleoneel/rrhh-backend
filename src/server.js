import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

import accionesRoutes from "./routes/acciones.routes.js";
import servidoresRoutes from "./routes/servidores.routes.js";
import authRoutes from "./routes/auth.routes.js";
import firmasRoutes from "./routes/firmas.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import tiposAcccionRoutes from "./routes/tiposAcccion.routes.js";
import catalogosRoutes from "./routes/catalogos.routes.js";
import accionesPdfRoutes from "./routes/accionesPdf.routes.js";
import firmantesRoutes from "./routes/firmantes.routes.js";
import notificacionesRoutes from "./routes/notificaciones.routes.js";
import distributivoRoutes from "./routes/distributivo.routes.js";

const app = express();
app.use(cors());
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

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
