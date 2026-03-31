import { Router } from "express";
import { pool } from "../../../db.js";
import { requireAuth, requireFirmante } from "../../../shared/middleware/auth.middleware.js";

const router = Router();

// GET /api/permisos/mis-permisos-firmante
router.get("/mis-permisos-firmante", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  try {
    const { rows } = await pool.query(
      `
      SELECT
        ps.id, ps.fecha, ps.hora_salida, ps.hora_regreso,
        ps.horas_solicitadas, ps.motivo, ps.estado,
        ps.observacion_jefe, ps.fecha_respuesta, ps.created_at,
        pt.nombre AS tipo_permiso
      FROM core.permiso_solicitud ps
      JOIN core.permiso_tipo pt ON pt.id = ps.permiso_tipo_id
      JOIN core.servidor sv ON sv.id = ps.servidor_id
      JOIN core.firmante f ON f.numero_identificacion = sv.numero_identificacion
      WHERE f.id = $1
      ORDER BY ps.created_at DESC
    `,
      [firmante_id],
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo permisos", error: err.message });
  }
});

// POST /api/permisos/solicitar-firmante
router.post("/solicitar-firmante", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  const { permiso_tipo_id, fecha, hora_salida, hora_regreso, motivo } = req.body;

  if (!permiso_tipo_id || !fecha || !hora_salida || !hora_regreso) {
    return res.status(400).json({ message: "Todos los campos son requeridos" });
  }

  const salida = new Date(`2000-01-01T${hora_salida}`);
  const regreso = new Date(`2000-01-01T${hora_regreso}`);
  const horas_solicitadas = (regreso - salida) / (1000 * 60 * 60);

  if (horas_solicitadas <= 0) {
    return res.status(400).json({ message: "La hora de regreso debe ser posterior" });
  }

  const anio = new Date(fecha).getFullYear();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const svR = await client.query(
      `
      SELECT sv.id AS servidor_id, p.unidad_organica_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      WHERE f.id = $1
      LIMIT 1
    `,
      [firmante_id],
    );

    if (!svR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "No se encontró servidor vinculado. Contacte a UATH.",
      });
    }

    const { servidor_id, unidad_organica_id } = svR.rows[0];

    const saldoR = await client.query(
      `
      SELECT horas_totales, horas_usadas
      FROM core.saldo_permiso
      WHERE servidor_id = $1 AND anio = $2
    `,
      [servidor_id, anio],
    );

    if (!saldoR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "No tiene saldo asignado. Contacte a UATH." });
    }

    const disponibles = saldoR.rows[0].horas_totales - saldoR.rows[0].horas_usadas;
    if (horas_solicitadas > disponibles) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: `Saldo insuficiente. Disponible: ${disponibles}h, Solicitado: ${horas_solicitadas}h`,
      });
    }

    const unidadR = await client.query(
      `SELECT jefe_superior_id FROM core.unidad_organica WHERE id = $1`,
      [unidad_organica_id],
    );

    const jefe_firmante_id = unidadR.rows[0]?.jefe_superior_id || null;

    const { rows } = await client.query(
      `
      INSERT INTO core.permiso_solicitud
        (servidor_id, permiso_tipo_id, unidad_organica_id, fecha,
         hora_salida, hora_regreso, horas_solicitadas, motivo, jefe_firmante_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
      [
        servidor_id,
        permiso_tipo_id,
        unidad_organica_id,
        fecha,
        hora_salida,
        hora_regreso,
        horas_solicitadas,
        motivo || null,
        jefe_firmante_id,
      ],
    );

    await client.query("COMMIT");
    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error creando solicitud", error: err.message });
  } finally {
    client.release();
  }
});

export default router;