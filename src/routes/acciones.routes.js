import { Router } from "express";
import { pool } from "../db.js";
import * as anexosCtrl from "../controllers/accionesAnexos.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { uploadFirma } from "../utils/upload.js";
import { subirFirmado } from "../controllers/accionesFirma.controller.js";
import { requireCargo } from "../middleware/requireCargo.middleware.js";
import { uploadAnexo } from "../utils/upload.js";



const router = Router();
const upload = uploadFirma();
const CARGO_ASISTENTE_UATH = "78de3b9c-a2f4-41ed-9823-bb72ee56d1f4";
const uploadAnx = uploadAnexo();


const parseBoolean = (value) => {
  console.log("parseBoolean recibió:", value, "tipo:", typeof value);

  if (value === undefined || value === null) return false;

  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    // Manejar más casos
    if (
      lower === "true" ||
      lower === "si" ||
      lower === "sí" ||
      lower === "yes" ||
      lower === "1" ||
      lower === "verdadero"
    ) {
      return true;
    }
    if (
      lower === "false" ||
      lower === "no" ||
      lower === "0" ||
      lower === "falso"
    ) {
      return false;
    }
    return Boolean(value);
  }
  if (typeof value === "number") return value === 1;
  return Boolean(value);
};
// POST /api/acciones
// Crea una acción de personal (BORRADOR)
router.post(
  "/",
  requireAuth,
  requireCargo([CARGO_ASISTENTE_UATH]),
  async (req, res) => {
    const {
      cedula,
      puestoId,
      tipoAccionNombre,
      tipoAccionOtroDetalle,
      rigeDesde,
      rigeHasta,
      motivo,
      presentoDeclaracionJurada,
    } = req.body;

    // Validaciones mínimas
    if (!cedula || !String(cedula).trim()) {
      return res.status(400).json({ message: "cedula es requerida" });
    }
    if (!tipoAccionNombre || !String(tipoAccionNombre).trim()) {
      return res.status(400).json({ message: "tipoAccionNombre es requerido" });
    }
    if (!rigeDesde) {
      return res.status(400).json({ message: "rigeDesde es requerido" });
    }
    if (tipoAccionNombre === "Otro") {
      if (!tipoAccionOtroDetalle || !String(tipoAccionOtroDetalle).trim()) {
        return res.status(400).json({
          message:
            "tipoAccionOtroDetalle es requerido cuando tipoAccionNombre es 'Otro'",
        });
      }
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 1) Resolver servidor + puesto ACTIVO por cédula
      const baseQ = `
          SELECT
            sv.id AS servidor_id,
            ap.id AS asignacion_puesto_id,
            p.id AS puesto_activo_id
          FROM core.servidor sv
          JOIN core.asignacion_puesto ap
            ON ap.servidor_id = sv.id
          AND ap.estado = 'ACTIVA'
          JOIN core.puesto p
            ON p.id = ap.puesto_id
          WHERE sv.numero_identificacion = $1
          ORDER BY ap.fecha_inicio DESC NULLS LAST
          LIMIT 1;
        `;
      const base = await client.query(baseQ, [String(cedula).trim()]);
      if (!base.rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ message: "Servidor no encontrado o sin asignación activa" });
      }
      const { servidor_id, puesto_activo_id } = base.rows[0];
      const puesto_id = puestoId || puesto_activo_id;

      // 2) Resolver tipo_accion_id por nombre
      const taQ = `
          SELECT id
          FROM core.tipo_accion
          WHERE nombre = $1 AND activo = true
          LIMIT 1;
        `;

      const ta = await client.query(taQ, [String(tipoAccionNombre).trim()]);
      if (!ta.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "Tipo de acción no existe o está inactivo",
        });
      }

      const tipo_accion_id = ta.rows[0].id;

      // 3) Crear accion_personal (BORRADOR) + campos extra
      const accQ = `
      INSERT INTO core.accion_personal
        (tipo_accion_id, servidor_id, puesto_id, motivo, estado, rige_desde, rige_hasta, tipo_accion_otro_detalle, presento_declaracion_jurada)
      VALUES
        ($1, $2, $3, $4, 'BORRADOR', $5::date, $6::date, $7, $8)
      RETURNING id, estado, numero_elaboracion, codigo_elaboracion;
  `;
      // 3) Crear accion_personal (BORRADOR) + campos extra
      const acc = await client.query(accQ, [
        tipo_accion_id,
        servidor_id,
        puesto_id,
        motivo,
        rigeDesde,
        rigeHasta || null,
        tipoAccionNombre === "Otro"
          ? String(tipoAccionOtroDetalle).trim()
          : null,
        parseBoolean(presentoDeclaracionJurada),
      ]);

      // 4) Clonar firmas desde plantilla
      const accion_id = acc.rows[0].id;
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

      // 5) Crear propuesta por defecto (para Step 3)
      const propuestaQ = `
          INSERT INTO core.accion_situacion_propuesta (accion_id)
          VALUES ($1)
          ON CONFLICT (accion_id) DO NOTHING;
        `;
      await client.query(propuestaQ, [accion_id]);

      await client.query("COMMIT");

      return res.status(201).json({
        accion_id,
        estado: acc.rows[0].estado,
        numero_elaboracion: acc.rows[0].numero_elaboracion,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(500).json({
        message: "Error creando acción",
        error: error.message,
      });
    } finally {
      client.release();
    }
  },
);
// GET /api/acciones
// Lista + filtros
router.get("/", requireAuth, async (req, res) => {
  const { estado, tipo_accion, desde, hasta, cedula, fecha } = req.query;

  try {
    let sql = `
        SELECT 
          ap.id, 
          ap.numero_elaboracion,
          ap.fecha_elaboracion,
          s.numero_identificacion AS cedula,
          s.nombres AS servidor,
          ta.nombre AS tipo_accion,
          ap.estado
        FROM core.accion_personal ap
        JOIN core.servidor s ON s.id = ap.servidor_id
        JOIN core.tipo_accion ta ON ta.id = ap.tipo_accion_id
        WHERE 1=1
      `;

    const values = [];
    let i = 1;

    if (estado) {
      sql += ` AND ap.estado = $${i++}`;
      values.push(estado);
    }

    if (tipo_accion) {
      sql += ` AND ta.nombre = $${i++}`;
      values.push(tipo_accion);
    }

    if (cedula) {
      sql += ` AND s.numero_identificacion = $${i++}`;
      values.push(cedula);
    }

    if (desde) {
      sql += ` AND ap.fecha_elaboracion::date >= $${i++}::date`;
      values.push(desde);
    }

    if (hasta) {
      sql += ` AND ap.fecha_elaboracion::date <= $${i++}::date`;
      values.push(hasta);
    }

    if (fecha) {
      sql += ` AND ap.fecha_elaboracion::date = $${i++}::date`;
      values.push(fecha);
    }

    sql += ` ORDER BY ap.fecha_elaboracion DESC`;

    const { rows } = await pool.query(sql, values);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({
      message: "Error obteniendo acciones de personal",
      error: error.message,
    });
  }
});

// GET /api/acciones/:id/firma-pendiente
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
    return res.json({ message: "No hay firmas pendientes" });
  }

  res.json(rows[0]);
});

// POST /api/acciones/:accionId/firmas/subir
router.post(
  "/:accionId/firmas/subir",
  requireAuth,
  upload.single("file"),
  subirFirmado,
);

// GET /api/acciones/:id/propuesta
router.get("/:id/propuesta", requireAuth, async (req, res) => {
  const { id } = req.params;

  const sql = `
      SELECT
        asp.*,
        u.nombre AS unidad_organica_nombre,
        d.nombre AS denominacion_puesto_nombre,
        eo.nombre AS escala_ocupacional_nombre
      FROM core.accion_situacion_propuesta asp
      LEFT JOIN core.unidad_organica u ON u.id = asp.unidad_organica_id
      LEFT JOIN core.denominacion_puesto d ON d.id = asp.denominacion_puesto_id
      LEFT JOIN core.escala_ocupacional eo ON eo.id = asp.escala_ocupacional_id
      WHERE asp.accion_id = $1
      LIMIT 1;
    `;

  const { rows } = await pool.query(sql, [id]);
  if (!rows.length) return res.json(null);
  return res.json(rows[0]);
});

// PUT /api/acciones/:id/propuesta
router.put("/:id/propuesta", requireAuth, async (req, res) => {
  const { id } = req.params;

  const {
    proceso_institucional,
    nivel_gestion,
    unidad_organica_id,
    denominacion_puesto_id,
    escala_ocupacional_id,
    lugar_trabajo,
    grado,
    rmu_puesto,
    partida_individual,
  } = req.body;

  const check = await pool.query(
    `SELECT estado FROM core.accion_personal WHERE id = $1`,
    [id],
  );

  if (!check.rows.length) {
    return res.status(404).json({ message: "Acción no encontrada" });
  }

  if (check.rows[0].estado !== "BORRADOR") {
    return res.status(409).json({
      message: "Solo se puede editar la propuesta en estado BORRADOR",
    });
  }

  const sql = `
      INSERT INTO core.accion_situacion_propuesta (
        accion_id,
        proceso_institucional_id,
        nivel_gestion_id,
        unidad_organica_id,
        denominacion_puesto_id,
        escala_ocupacional_id,
        lugar_trabajo,
        grado,
        rmu_puesto,
        partida_individual
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
      )
      ON CONFLICT (accion_id)
      DO UPDATE SET
        proceso_institucional_id = EXCLUDED.proceso_institucional_id,
        nivel_gestion_id = EXCLUDED.nivel_gestion_id,
        unidad_organica_id = EXCLUDED.unidad_organica_id,
        denominacion_puesto_id = EXCLUDED.denominacion_puesto_id,
        escala_ocupacional_id = EXCLUDED.escala_ocupacional_id,
        lugar_trabajo = EXCLUDED.lugar_trabajo,
        grado = EXCLUDED.grado,
        rmu_puesto = EXCLUDED.rmu_puesto,
        partida_individual = EXCLUDED.partida_individual
      RETURNING *;
    `;

  const values = [
    id,
    proceso_institucional || null,
    nivel_gestion || null,
    unidad_organica_id || null,
    denominacion_puesto_id || null,
    escala_ocupacional_id || null,
    lugar_trabajo || null,
    grado || null,
    rmu_puesto ?? null,
    partida_individual || null,
  ];

  const { rows } = await pool.query(sql, values);
  return res.json(rows[0]);
});

router.get("/:accionId/anexos", requireAuth, anexosCtrl.listar);
router.post(
  "/:accionId/anexos",
  requireAuth,
  uploadAnx.single("file"),
  anexosCtrl.subir
);
router.get(
  "/:accionId/anexos/:anexoId/descargar",
  requireAuth,
  anexosCtrl.descargar
);

router.delete(
  "/:accionId/anexos/:anexoId",
  requireAuth,
  anexosCtrl.eliminar
);

export default router;
