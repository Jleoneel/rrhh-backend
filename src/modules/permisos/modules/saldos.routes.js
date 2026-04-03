import { Router } from "express";
import { pool } from "../../../db.js";
import {
  requireAuth,
  requireFirmante,
  requireServidor,
} from "../../../shared/middleware/auth.middleware.js";

const router = Router();

// GET /api/permisos/saldos
router.get("/saldos", requireAuth, requireFirmante, async (req, res) => {
  const anio = new Date().getFullYear();
  try {
    const { rows } = await pool.query(
      `
      SELECT
        sp.id, sp.anio, sp.horas_totales, sp.horas_usadas,
        (sp.horas_totales - sp.horas_usadas) AS horas_disponibles,
        sv.nombres, sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica
      FROM core.saldo_permiso sp
      JOIN core.servidor sv ON sv.id = sp.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      WHERE sp.anio = $1
      ORDER BY sv.nombres ASC;
    `,
      [anio],
    );
    return res.json(rows);
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error obteniendo saldos", error: err.message });
  }
});

// POST /api/permisos/saldos → inicializar o ajustar saldo
router.post("/saldos", requireAuth, requireFirmante, async (req, res) => {
  const { servidor_id, dias, anio, descripcion } = req.body; // ← días en lugar de horas_totales
  const anioFinal = anio || new Date().getFullYear();

  if (!servidor_id || !dias) {
    return res
      .status(400)
      .json({ message: "servidor_id y dias son requeridos" });
  }

  const horas_totales = parseFloat(dias) * 8; // ← conversión aquí

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      INSERT INTO core.saldo_permiso (servidor_id, anio, horas_totales)
      VALUES ($1, $2, $3)
      ON CONFLICT (servidor_id, anio)
      DO UPDATE SET horas_totales = $3, updated_at = NOW()
      RETURNING *
    `,
      [servidor_id, anioFinal, horas_totales],
    );

    await client.query(
      `
      INSERT INTO core.permiso_movimiento
        (servidor_id, anio, horas, tipo, descripcion, creado_por)
      VALUES ($1, $2, $3, 'INICIALIZACION', $4, $5)
    `,
      [
        servidor_id,
        anioFinal,
        horas_totales,
        descripcion || `Inicialización: ${dias} días`,
        req.user.firmante_id,
      ],
    );

    await client.query("COMMIT");
    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    return res
      .status(500)
      .json({ message: "Error creando saldo", error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/permisos/mi-saldo (para servidor)
router.get("/mi-saldo", requireAuth, requireServidor, async (req, res) => {
  const { servidor_id } = req.user;
  const anio = new Date().getFullYear();
  try {
    const { rows } = await pool.query(
      `
      SELECT
        horas_totales, horas_usadas,
        (horas_totales - horas_usadas) AS horas_disponibles, anio
      FROM core.saldo_permiso
      WHERE servidor_id = $1 AND anio = $2
    `,
      [servidor_id, anio],
    );

    if (!rows.length) {
      return res.json({
        horas_totales: 0,
        horas_usadas: 0,
        horas_disponibles: 0,
        anio,
      });
    }
    return res.json(rows[0]);
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error obteniendo saldo", error: err.message });
  }
});

// GET /api/permisos/mi-saldo-firmante
router.get(
  "/mi-saldo-firmante",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    const anio = new Date().getFullYear();
    try {
      const { rows } = await pool.query(
        `
      SELECT
        sp.horas_totales, sp.horas_usadas,
        (sp.horas_totales - sp.horas_usadas) AS horas_disponibles, sp.anio
      FROM core.saldo_permiso sp
      JOIN core.servidor sv ON sv.id = sp.servidor_id
      JOIN core.firmante f ON f.numero_identificacion = sv.numero_identificacion
      WHERE f.id = $1 AND sp.anio = $2
      LIMIT 1
    `,
        [firmante_id, anio],
      );

      if (!rows.length) {
        return res.json({
          horas_totales: 0,
          horas_usadas: 0,
          horas_disponibles: 0,
          anio,
        });
      }
      return res.json(rows[0]);
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error obteniendo saldo", error: err.message });
    }
  },
);

export default router;
