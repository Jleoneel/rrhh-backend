import { Router } from "express";
import { pool } from "../../../db.js";
import {
  requireAuth,
  requireFirmante,
  requireServidor,
} from "../../../shared/middleware/auth.middleware.js";

const router = Router();

router.get("/saldos", requireAuth, requireFirmante, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        sp.id, sp.horas_totales, sp.horas_usadas,
        (sp.horas_totales - sp.horas_usadas) AS horas_disponibles,
        sp.fecha_ingreso, sp.updated_at,
        sv.nombres, sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica
      FROM core.saldo_permiso sp
      JOIN core.servidor sv ON sv.id = sp.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      ORDER BY sv.nombres ASC;
    `);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo saldos", error: err.message });
  }
});

router.post("/saldos", requireAuth, requireFirmante, async (req, res) => {
  const { servidor_id, dias, descripcion, fecha_ingreso } = req.body;

  if (!servidor_id || !dias || !fecha_ingreso) {
    return res.status(400).json({ message: "servidor_id, dias y fecha_ingreso son requeridos" });
  }

  const horas_totales = parseFloat(dias) * 8;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(`
      INSERT INTO core.saldo_permiso (servidor_id, horas_totales, fecha_ingreso)
      VALUES ($1, $2, $3)
      ON CONFLICT (servidor_id)
      DO UPDATE SET 
        horas_totales = LEAST(saldo_permiso.horas_totales + $2, 480),
        fecha_ingreso = $3,
        updated_at = NOW()
      RETURNING *
    `, [servidor_id, horas_totales, fecha_ingreso]);

    await client.query(`
      INSERT INTO core.permiso_movimiento
        (servidor_id, horas, tipo, descripcion, creado_por)
      VALUES ($1, $2, 'INICIALIZACION', $3, $4)
    `, [servidor_id, horas_totales, descripcion || `Inicialización: ${dias} días`, req.user.firmante_id]);

    await client.query("COMMIT");
    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error creando saldo", error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/permisos/mi-saldo (para servidor)
router.get("/mi-saldo", requireAuth, requireServidor, async (req, res) => {
  const { servidor_id } = req.user;
  try {
    const { rows } = await pool.query(`
      SELECT
        horas_totales, horas_usadas,
        (horas_totales - horas_usadas) AS horas_disponibles,
        fecha_ingreso
      FROM core.saldo_permiso
      WHERE servidor_id = $1
    `, [servidor_id]);

    if (!rows.length) {
      return res.json({ horas_totales: 0, horas_usadas: 0, horas_disponibles: 0 });
    }
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo saldo", error: err.message });
  }
});

// GET /api/permisos/mi-saldo-firmante
router.get("/mi-saldo-firmante", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  try {
    const { rows } = await pool.query(`
      SELECT
        sp.horas_totales, sp.horas_usadas,
        (sp.horas_totales - sp.horas_usadas) AS horas_disponibles,
        sp.fecha_ingreso
      FROM core.saldo_permiso sp
      JOIN core.servidor sv ON sv.id = sp.servidor_id
      JOIN core.firmante f ON f.numero_identificacion = sv.numero_identificacion
      WHERE f.id = $1
      LIMIT 1
    `, [firmante_id]);

    if (!rows.length) {
      return res.json({ horas_totales: 0, horas_usadas: 0, horas_disponibles: 0 });
    }
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo saldo", error: err.message });
  }
});

export default router;
