import { Router } from "express";
import { pool } from "../../db.js";
import {
  requireAuth,
  requireFirmante,
  requireServidor,
} from "../../shared/middleware/auth.middleware.js";
import {
  addConnection,
  removeConnection,
} from "../../shared/utils/sseManager.js";

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
        np.id, np.solicitud_id, np.tipo, np.leida, TO_CHAR(np.creada_en, 'YYYY-MM-DD HH24:MI:SS') AS creada_en,
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
    console.error("Error en notificaciones-permiso:", err);
    return res.status(500).json({ message: "Error" });
  }
});

router.get("/servidor", requireAuth, requireServidor, async (req, res) => {
  const { servidor_id } = req.user;
  try {
    const { rows } = await pool.query(
      `
      SELECT
        np.id, np.solicitud_id, np.tipo, np.leida, TO_CHAR(np.creada_en, 'YYYY-MM-DD HH24:MI:SS') AS creada_en,
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
    console.error("Error en notificaciones-permiso:", err);
    return res.status(500).json({ message: "Error" });
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
    console.error("Error en notificaciones-permiso:", err);
    return res.status(500).json({ message: "Error" });
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
      console.error("Error en notificaciones-permiso:", err);
      return res.status(500).json({ message: "Error" });
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
      console.error("Error en notificaciones-permiso:", err);
      return res.status(500).json({ message: "Error" });
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
        np.tipo, np.leida, TO_CHAR(np.creada_en, 'YYYY-MM-DD HH24:MI:SS') AS creada_en,
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
      console.error("Error en notificaciones-permiso:", err);
      return res.status(500).json({ message: "Error" });
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
        np.tipo, np.leida, TO_CHAR(np.creada_en, 'YYYY-MM-DD HH24:MI:SS') AS creada_en,
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
      console.error("Error en notificaciones-permiso:", err);
      return res.status(500).json({ message: "Error" });
    }
  },
);

// GET notificaciones de cronograma de vacaciones (servidor) — bloques que
// un jefe le planificó y todavía no leyó/solicitó.
router.get(
  "/cronograma-servidor",
  requireAuth,
  requireServidor,
  async (req, res) => {
    const { servidor_id } = req.user;
    try {
      const { rows } = await pool.query(
        `
      SELECT
        np.id, np.cronograma_bloque_id, np.tipo, np.leida,
        TO_CHAR(np.creada_en, 'YYYY-MM-DD HH24:MI:SS') AS creada_en,
        cb.anio,
        TO_CHAR(cb.fecha_desde, 'YYYY-MM-DD') AS fecha_desde,
        TO_CHAR(cb.fecha_hasta, 'YYYY-MM-DD') AS fecha_hasta,
        cb.dias
      FROM core.notificacion_permiso np
      JOIN core.cronograma_vacaciones_bloque cb ON cb.id = np.cronograma_bloque_id
      WHERE np.servidor_id = $1
        AND np.cronograma_bloque_id IS NOT NULL
        AND np.leida = false
      ORDER BY np.creada_en DESC
    `,
        [servidor_id],
      );
      return res.json(rows);
    } catch (err) {
      console.error("Error en notificaciones-permiso:", err);
      return res.status(500).json({ message: "Error" });
    }
  },
);

export default router;
