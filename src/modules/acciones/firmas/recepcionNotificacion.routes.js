import { Router } from "express";
import { pool } from "../../../db.js";
import { requireAuth } from "../../../shared/middleware/auth.middleware.js";
import {
  addConnection,
  removeConnection,
} from "../../../shared/utils/sseManager.js";
import { resolverServidorPropio } from "../../../shared/utils/resolverServidorPropio.js";

const router = Router();

// SSE — conexión en tiempo real para el servidor "propio" del usuario
// autenticado (servidor puro, o firmante que también existe como
// servidor con la misma cédula).
router.get("/stream", requireAuth, async (req, res) => {
  const { servidorId } = await resolverServidorPropio(req);
  if (!servidorId) return res.status(204).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const ping = setInterval(() => res.write(": ping\n\n"), 30000);
  const key = `recepcion-${servidorId}`;
  addConnection(key, res);

  req.on("close", () => {
    clearInterval(ping);
    removeConnection(key, res);
  });
});

// GET /api/recepcion-notificaciones — notificaciones no leídas
router.get("/", requireAuth, async (req, res) => {
  const { servidorId } = await resolverServidorPropio(req);
  if (!servidorId) return res.json([]);

  try {
    const { rows } = await pool.query(
      `
      SELECT
        nr.id, nr.accion_id, nr.leida,
        TO_CHAR(nr.creada_en, 'YYYY-MM-DD HH24:MI:SS') AS creada_en,
        ap.codigo_elaboracion,
        ta.nombre AS tipo_accion
      FROM core.notificacion_recibido_servidor nr
      JOIN core.accion_personal ap ON ap.id = nr.accion_id
      JOIN core.tipo_accion ta ON ta.id = ap.tipo_accion_id
      WHERE nr.servidor_id = $1 AND nr.leida = false
      ORDER BY nr.creada_en DESC
      `,
      [servidorId],
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error", error: err.message });
  }
});

// PATCH /api/recepcion-notificaciones/:id/leer
router.patch("/:id/leer", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { servidorId } = await resolverServidorPropio(req);
  if (!servidorId) return res.status(404).json({ message: "No encontrado" });

  try {
    await pool.query(
      `UPDATE core.notificacion_recibido_servidor
       SET leida = true WHERE id = $1 AND servidor_id = $2`,
      [id, servidorId],
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Error", error: err.message });
  }
});

// PATCH /api/recepcion-notificaciones/leer-todas
router.patch("/leer-todas", requireAuth, async (req, res) => {
  const { servidorId } = await resolverServidorPropio(req);
  if (!servidorId) return res.json({ ok: true });

  try {
    await pool.query(
      `UPDATE core.notificacion_recibido_servidor
       SET leida = true WHERE servidor_id = $1 AND leida = false`,
      [servidorId],
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Error", error: err.message });
  }
});

export default router;
