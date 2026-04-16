import { Router } from "express";
import { pool } from "../../../db.js";
import {
  requireAuth,
  requireFirmante,
  requireServidor,
} from "../../../shared/middleware/auth.middleware.js";
import {
  addConnection,
  removeConnection,
} from "../../../shared/utils/sseManager.js";

const router = Router();
// SSE para firmantes (jefes)
router.get("/stream-firmante", requireAuth, requireFirmante, (req, res) => {
  const { firmante_id } = req.user;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const ping = setInterval(() => res.write(": ping\n\n"), 30000);
  const key = `permiso-firmante-${firmante_id}`;
  addConnection(key, res);

  req.on("close", () => {
    clearInterval(ping);
    removeConnection(key, res);
  });
});

// SSE para servidores
router.get("/stream-servidor", requireAuth, requireServidor, (req, res) => {
  const { servidor_id } = req.user;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const ping = setInterval(() => res.write(": ping\n\n"), 30000);
  const key = `permiso-servidor-${servidor_id}`;
  addConnection(key, res);

  req.on("close", () => {
    clearInterval(ping);
    removeConnection(key, res);
  });
});

// GET notificaciones no leídas
router.get("/firmante", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  try {
    const { rows } = await pool.query(
      `
      SELECT
        np.id, np.solicitud_id, np.tipo, np.leida, np.creada_en,
        ps.fecha, ps.horas_solicitadas,
        sv.nombres AS servidor_nombre
      FROM core.notificacion_permiso np
      JOIN core.permiso_solicitud ps ON ps.id = np.solicitud_id
      JOIN core.servidor sv ON sv.id = ps.servidor_id
      WHERE np.firmante_id = $1 AND np.leida = false
      ORDER BY np.creada_en DESC
    `,
      [firmante_id],
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error", error: err.message });
  }
});

router.get("/servidor", requireAuth, requireServidor, async (req, res) => {
  const { servidor_id } = req.user;
  try {
    const { rows } = await pool.query(
      `
      SELECT
        np.id, np.solicitud_id, np.tipo, np.leida, np.creada_en,
        ps.fecha, ps.horas_solicitadas
      FROM core.notificacion_permiso np
      JOIN core.permiso_solicitud ps ON ps.id = np.solicitud_id
      WHERE np.servidor_id = $1 AND np.leida = false
      ORDER BY np.creada_en DESC
    `,
      [servidor_id],
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error", error: err.message });
  }
});

// PATCH marcar leída
router.patch("/:id/leer", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE core.notificacion_permiso SET leida = true WHERE id = $1`,
      [id],
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Error", error: err.message });
  }
});

router.patch(
  "/leer-todas-firmante",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    try {
      await pool.query(
        `UPDATE core.notificacion_permiso SET leida = true WHERE firmante_id = $1 AND leida = false`,
        [firmante_id],
      );
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ message: "Error", error: err.message });
    }
  },
);

router.patch(
  "/leer-todas-servidor",
  requireAuth,
  requireServidor,
  async (req, res) => {
    const { servidor_id } = req.user;
    try {
      await pool.query(
        `UPDATE core.notificacion_permiso SET leida = true WHERE servidor_id = $1 AND leida = false`,
        [servidor_id],
      );
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ message: "Error", error: err.message });
    }
  },
);

// GET notificaciones vacaciones firmante
router.get(
  "/vacaciones-firmante",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    try {
      const { rows } = await pool.query(
        `
      SELECT
        np.id, np.vacacion_solicitud_id AS solicitud_id, 
        np.tipo, np.leida, np.creada_en,
        vs.dias_solicitados,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
        sv.nombres AS servidor_nombre
      FROM core.notificacion_permiso np
      JOIN core.vacacion_solicitud vs ON vs.id = np.vacacion_solicitud_id
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      WHERE np.firmante_id = $1 
        AND np.vacacion_solicitud_id IS NOT NULL
        AND np.leida = false
      ORDER BY np.creada_en DESC
    `,
        [firmante_id],
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ message: "Error", error: err.message });
    }
  },
);

// GET notificaciones vacaciones servidor
router.get(
  "/vacaciones-servidor",
  requireAuth,
  requireServidor,
  async (req, res) => {
    const { servidor_id } = req.user;
    try {
      const { rows } = await pool.query(
        `
      SELECT
        np.id, np.vacacion_solicitud_id AS solicitud_id,
        np.tipo, np.leida, np.creada_en,
        vs.dias_solicitados,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin
      FROM core.notificacion_permiso np
      JOIN core.vacacion_solicitud vs ON vs.id = np.vacacion_solicitud_id
      WHERE np.servidor_id = $1
        AND np.vacacion_solicitud_id IS NOT NULL
        AND np.leida = false
      ORDER BY np.creada_en DESC
    `,
        [servidor_id],
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ message: "Error", error: err.message });
    }
  },
);

export default router;
