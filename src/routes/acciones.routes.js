import { Router } from "express";
import { pool } from "../db.js";

import { requireAuth } from "../middleware/auth.middleware.js";
import { uploadFirma } from "../utils/upload.js";
import { subirFirmado } from "../controllers/accionesFirma.controller.js";
import { requireCargo } from "../middleware/requireCargo.middleware.js";

const router = Router();
const upload = uploadFirma();
const CARGO_ASISTENTE_UATH = "78de3b9c-a2f4-41ed-9823-bb72ee56d1f4";

//Crea una acción de personal (BORRADOR)
router.post("/", requireAuth,requireCargo([CARGO_ASISTENTE_UATH]), async (req, res) => {
  const { cedula, tipoAccionNombre, motivo } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    //Resolver servidor + puesto activo
    const baseQ = `
      SELECT sv.id AS servidor_id, p.id AS puesto_id
      FROM core.servidor sv
      JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado='ACTIVA'
      JOIN core.puesto p ON p.id = ap.puesto_id
      WHERE sv.numero_identificacion = $1
      ORDER BY ap.fecha_inicio DESC
      LIMIT 1;
    `;
    const base = await client.query(baseQ, [cedula]);
    if (!base.rows.length) {
      throw new Error("Servidor no encontrado o sin asignación activa");
    }

    //Resolver tipo de acción
    const taQ = `
      SELECT id
      FROM core.tipo_accion
      WHERE nombre = $1 AND activo = true
      LIMIT 1;
    `;
    const ta = await client.query(taQ, [tipoAccionNombre]);
    if (!ta.rows.length) {
      throw new Error("Tipo de acción no existe o está inactivo");
    }

    const { servidor_id, puesto_id } = base.rows[0];
    const tipo_accion_id = ta.rows[0].id;

    //Crear acción_personal (BORRADOR)
    const accQ = `
      INSERT INTO core.accion_personal
        (tipo_accion_id, servidor_id, puesto_id, motivo, estado)
      VALUES
        ($1, $2, $3, $4, 'BORRADOR')
      RETURNING id;
    `;
    const acc = await client.query(accQ, [
      tipo_accion_id,
      servidor_id,
      puesto_id,
      motivo || null,
    ]);

    const accion_id = acc.rows[0].id;

    //Clonar firmas desde plantilla
    const cloneQ = `
      INSERT INTO core.accion_firma
        (accion_id, rol_firma, orden, cargo_id, estado)
      SELECT
        $1,
        taf.rol_firma,
        taf.orden,
        taf.cargo_id,
        'PENDIENTE'
      FROM core.tipo_accion_firma taf
      WHERE taf.tipo_accion_id = $2
        AND taf.activo = true
      ORDER BY taf.orden;
    `;
    await client.query(cloneQ, [accion_id, tipo_accion_id]);

    await client.query("COMMIT");
    res.status(201).json({
      accion_id,
      estado: "BORRADOR",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({
      message: "Error creando acción",
      error: error.message,
    });
  } finally {
    client.release();
  }
});

//GET /api/acciones/:id/firma-pendiente
router.get("/:id/firma-pendiente", requireAuth, async (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT
      af.id,
      af.orden,
      af.rol_firma,
      af.cargo_id,
      c.nombre AS cargo_requerido,
      af.estado
    FROM core.accion_firma af
    JOIN core.cargo c ON c.id = af.cargo_id
    WHERE af.accion_id = $1
      AND af.estado = 'PENDIENTE'
    ORDER BY af.orden
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [id]);

  if (!rows.length) {
    return res.json({
      message: "No hay firmas pendientes",
    });
  }

  res.json(rows[0]);
});

//POST /api/acciones/:accionId/firmas/subir
router.post(
  "/:accionId/firmas/subir",
  requireAuth,
  upload.single("file"),
  subirFirmado
);

export default router;
