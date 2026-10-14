import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// override: true — en producción, pm2 puede mantener variables de entorno
// cacheadas de un arranque/ecosystem anterior; sin esto, dotenv detecta que
// ya existen y NO las actualiza con lo que hay en .env (se ve en los logs
// como "injecting env (0) from .env"), dejando vivo un SMTP_SECURE/SMTP_PORT
// desactualizado aunque .env esté correcto.
dotenv.config({ override: true });

import { requireAuth } from "./shared/middleware/auth.middleware.js";
import { requireAccesoUploads } from "./shared/middleware/requireAccesoUploads.middleware.js";
import accionesRoutes from "./modules/acciones/acciones.routes.js";
import servidoresRoutes from "./modules/servidores/servidores.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import firmasRoutes from "./modules/acciones/firmas/firmas.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import tiposAcccionRoutes from "./modules/acciones/tiposAcccion.routes.js";
import catalogosRoutes from "./modules/catalogos/catalogos.routes.js";
import accionesPdfRoutes from "./modules/acciones/accionesPdf.routes.js";
import firmantesRoutes from "./modules/firmantes/firmantes.routes.js";
import distributivoRoutes from "./modules/distributivo/distributivo.routes.js";
import firmaNotificacionRoutes from "./modules/acciones/firmas/firmaNotificacion.routes.js";
import recepcionNotificacionRoutes from "./modules/acciones/firmas/recepcionNotificacion.routes.js";
import permisosRoutes from "./modules/permisos/permisos.routes.js"
import { iniciarCronAcumularSaldos } from "./shared/jobs/acumularSaldos.job.js";
import distributivoposicionalRoutes from "./modules/distributivo/distributivo-posicional.routes.js";
import "./shared/jobs/purgarFirmasIntermedias.job.js";

const app = express();

// Cabeceras de seguridad HTTP (X-Content-Type-Options, HSTS, X-Frame-Options,
// etc). Este backend es solo API JSON + archivos estáticos protegidos
// (/uploads), sin páginas HTML propias, así que el CSP por defecto de
// helmet no tiene nada que romper acá — el frontend vive en otro origen
// (Vite) y ya se protege con su propio build.
app.use(helmet());
// Este backend es de uso exclusivamente interno (red del hospital, sin
// exposición a internet), así que en vez de mantener una lista de IPs
// exactas que hay que tocar cada vez que se conecta una máquina nueva,
// se permite cualquier origen dentro del rango privado 192.168.0.0/16
// (el mismo rango de todas las IPs que se han agregado hasta ahora).
// CORS_EXTRA_ORIGINS sigue disponible, vía .env, para orígenes fuera de
// ese rango (otra subred, un dominio, etc.) sin tocar código.
const RED_INTERNA_ORIGEN = /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/;

const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  ...extraOrigins,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        RED_INTERNA_ORIGEN.test(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error("No permitido por CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());

// Crear carpeta uploads si no existe
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Exponer archivos estáticos — PROTEGIDO en dos capas: antes era público
// (cualquiera podía descargar PDFs de Acciones de Personal, anexos y
// certificados P12 sin login, solo adivinando la ruta — codigo_elaboracion
// es secuencial). requireAuth acepta el token por header Authorization o
// por ?token=, porque los <a>/window.open que abren estas rutas no pueden
// mandar headers — ver AccionesRecepcionServidor.jsx y VerAccionModal.jsx,
// que agregan ?token= al construir la URL. requireAccesoUploads además
// limita /uploads/acciones/* a UATH/jefes o al servidor dueño de esa
// Acción — sin esto, cualquier empleado logueado podía ver documentos de
// cualquier otro.
app.use("/uploads", requireAuth, requireAccesoUploads, express.static(uploadsDir));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/acciones", accionesRoutes);
app.use("/api/servidores", servidoresRoutes);
app.use("/api/firmas", firmasRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/tipos-accion", tiposAcccionRoutes);
app.use("/api/catalogos", catalogosRoutes);
app.use("/api", accionesPdfRoutes);
app.use("/api/firmantes", firmantesRoutes);
app.use("/api/distributivo", distributivoRoutes);
app.use("/api/firma-notificaciones", firmaNotificacionRoutes);
app.use("/api/recepcion-notificaciones", recepcionNotificacionRoutes);
app.use("/api/permisos", permisosRoutes);
app.use("/api/distributivo", distributivoposicionalRoutes);


const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
iniciarCronAcumularSaldos();

