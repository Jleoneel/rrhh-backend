import { Router } from "express";
import { pool } from "../db.js";

import { requireAuth } from "../middleware/auth.middleware.js";
import { uploadFirma } from "../utils/upload.js";
import { subirFirmado } from "../controllers/accionesFirma.controller.js";

const router = Router();
const upload = uploadFirma();

router.post("/", async (req, res) => {
  const { cedula, tipoAccionNombre, motivo } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) resolver servidor + puesto activo
    const baseQ = `
      SELECT sv.id AS servidor_id, p.id AS puesto_id
      FROM core.servidor sv
      JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado='ACTIVA'
      JOIN core.puesto p ON p.id = ap.puesto_id
      WHERE sv.numero_identificacion = $1
      ORDER BY ap.fecha_inicio DESC NULLS LAST
      LIMIT 1;
    `;
    const base = await client.query(baseQ, [cedula]);
    if (!base.rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ message: "Servidor no encontrado o sin asignación activa" });
    }

    // 2) resolver tipo_accion
    const taQ = `SELECT id FROM core.tipo_accion WHERE nombre = $1 AND activo = true LIMIT 1;`;
    const ta = await client.query(taQ, [tipoAccionNombre]);
    if (!ta.rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Tipo de acción no existe o está inactivo" });
    }

    const { servidor_id, puesto_id } = base.rows[0];
    const tipo_accion_id = ta.rows[0].id;

    // 3) crear accion_personal
    const insAccQ = `
      INSERT INTO core.accion_personal (tipo_accion_id, servidor_id, puesto_id, motivo, estado)
      VALUES ($1,$2,$3,$4,'BORRADOR')
      RETURNING id;
    `;
    const acc = await client.query(insAccQ, [
      tipo_accion_id,
      servidor_id,
      puesto_id,
      motivo || null,
    ]);
    const accion_id = acc.rows[0].id;

    // 4) clonar firmas (plantilla)
    const cloneQ = `
      INSERT INTO core.accion_firma (accion_id, rol_firma, orden, cargo_id, estado)
      SELECT $1, taf.rol_firma, taf.orden, taf.cargo_id, 'PENDIENTE'
      FROM core.tipo_accion_firma taf
      WHERE taf.tipo_accion_id = $2 AND taf.activo = true
      ORDER BY taf.orden;
    `;
    await client.query(cloneQ, [accion_id, tipo_accion_id]);

    await client.query("COMMIT");
    res.status(201).json({ accion_id });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: "Error creando acción", error: e.message });
  } finally {
    client.release();
  }
});

// GET /api/acciones/:id/firma-pendiente
router.get("/:id/firma-pendiente", async (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT
      af.id,
      af.orden,
      af.rol_firma,
      c.nombre AS cargo_requerido,
      f.nombre AS firmante_asignado,
      af.estado
    FROM core.accion_firma af
    JOIN core.cargo c ON c.id = af.cargo_id
    LEFT JOIN core.firmante f ON f.id = af.firmante_id
    WHERE af.accion_id = $1 AND af.estado = 'PENDIENTE'
    ORDER BY af.orden
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [id]);
  if (!rows.length)
    return res
      .status(200)
      .json({
        message: "No hay firmas pendientes (posiblemente ya finalizada)",
      });
  res.json(rows[0]);
});

// POST /api/acciones/:accionId/firmas/subir
router.post(
  "/:accionId/firmas/subir",
  requireAuth,
  upload.single("file"),
  subirFirmado,
);

// POST /api/acciones/:id/documentos  (registrar version pdf)
router.post("/:id/documentos", async (req, res) => {
  const { id } = req.params;
  const { version, tipo, archivo_path, subido_por, hash_sha256 } = req.body;

  const sql = `
  INSERT INTO core.accion_documento
    (accion_id, version, tipo, archivo_path, subido_en, subido_por_firmante_id)
  VALUES
    ($1, $2, 'FIRMADO_PARCIAL', $3, NOW(), $4)
  RETURNING id;
`;

  const { rows } = await pool.query(sql, [
    accionId,
    version,
    archivoPath,
    firmante_id,
  ]);
  res.status(201).json({ documento_id: rows[0].id });
});

// PATCH /api/acciones/:id/firmar-siguiente 
router.patch("/:id/firmar-siguiente", async (req, res) => {
  const { id } = req.params;

  const sql = `
    UPDATE core.accion_firma
    SET estado='FIRMADO', firmado_en=now()
    WHERE id = (
      SELECT id
      FROM core.accion_firma
      WHERE accion_id=$1 AND estado='PENDIENTE'
      ORDER BY orden
      LIMIT 1
    )
    RETURNING id, orden, rol_firma, estado, firmado_en;
  `;
  const { rows } = await pool.query(sql, [id]);
  if (!rows.length)
    return res
      .status(400)
      .json({ message: "No hay firma pendiente que marcar" });
  res.json(rows[0]);
});

export default router;
