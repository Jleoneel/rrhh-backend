import { pool } from "../db.js";
import { addConnection, removeConnection } from "../utils/sseManager.js";

// GET /api/firma-notificaciones/stream
// Abre la conexión SSE para el cargo logueado
export function stream(req, res) {
  const { cargo_id } = req.user;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Ping cada 30s para mantener la conexión viva
  const ping = setInterval(() => {
    res.write(": ping\n\n");
  }, 30000);

  addConnection(cargo_id, res);

  req.on("close", () => {
    clearInterval(ping);
    removeConnection(cargo_id, res);
  });
}

// GET /api/firma-notificaciones
// Obtener notificaciones no leídas del cargo logueado
export async function listar(req, res) {
  const { cargo_id } = req.user;

  try {
    const { rows } = await pool.query(
      `SELECT
         nf.id,
         nf.accion_id,
         nf.rol_firma,
         nf.orden,
         nf.leida,
         nf.creada_en,
         ap.codigo_elaboracion
       FROM core.notificacion_firma nf
       JOIN core.accion_personal ap ON ap.id = nf.accion_id
       WHERE nf.cargo_id = $1 AND nf.leida = false
       ORDER BY nf.creada_en DESC;`,
      [cargo_id],
    );

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({
      message: "Error obteniendo notificaciones",
      error: err.message,
    });
  }
}

// PATCH /api/firma-notificaciones/:id/leer
// Marcar una notificación como leída
export async function marcarLeida(req, res) {
  const { id } = req.params;
  const { cargo_id } = req.user;

  try {
    await pool.query(
      `UPDATE core.notificacion_firma
       SET leida = true
       WHERE id = $1 AND cargo_id = $2;`,
      [id, cargo_id],
    );

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({
      message: "Error marcando notificación como leída",
      error: err.message,
    });
  }
}

// PATCH /api/firma-notificaciones/leer-todas
// Marcar todas las notificaciones como leídas
export async function marcarTodasLeidas(req, res) {
  const { cargo_id } = req.user;

  try {
    await pool.query(
      `UPDATE core.notificacion_firma
       SET leida = true
       WHERE cargo_id = $1 AND leida = false;`,
      [cargo_id],
    );

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({
      message: "Error marcando notificaciones como leídas",
      error: err.message,
    });
  }
}