import { Router } from "express";
import { pool } from "../../../db.js";
import {
  requireAuth,
  requireFirmante,
  requireServidor,
} from "../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../shared/utils/sseManager.js";
import { generarPdfVacacion } from "../modules/vacacionesPdf.controller.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { id } = req.params;

    // Determinar la subcarpeta según el endpoint
    const url = req.path;
    let subdir = "base";
    if (url.includes("subir-firma-jefe")) subdir = "jefe";
    else if (url.includes("subir-firma-superior")) subdir = "superior";
    else if (url.includes("subir-firma-uath")) subdir = "uath";

    const dir = path.resolve(
      process.env.UPLOADS_DIR || "uploads",
      "vacaciones",
      `solicitud_${id}`,
      subdir,
    );
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `firmado_${Date.now()}.pdf`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Solo se permiten archivos PDF"));
    }
    cb(null, true);
  },
});

// ═══════════════════════════════════════════════════════════════
// RUTAS ESPECÍFICAS PRIMERO (antes de las rutas con parámetros)
// ═══════════════════════════════════════════════════════════════

// GET /api/permisos/mis-vacaciones
router.get(
  "/mis-vacaciones",
  requireAuth,
  requireServidor,
  async (req, res) => {
    const { servidor_id } = req.user;
    try {
      const { rows } = await pool.query(
        `
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado,
        vs.observacion_jefe, vs.observacion_gerente, vs.observacion_uath,
        TO_CHAR(vs.fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
        vs.created_at
      FROM core.vacacion_solicitud vs
      WHERE vs.servidor_id = $1
      ORDER BY vs.created_at DESC
    `,
        [servidor_id],
      );
      return res.json(rows);
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error obteniendo vacaciones", error: err.message });
    }
  },
);

// GET /api/permisos/mis-vacaciones-firmante
router.get(
  "/mis-vacaciones-firmante",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    try {
      const { rows } = await pool.query(
        `
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado,
        vs.observacion_jefe, vs.observacion_gerente, vs.observacion_uath,
        TO_CHAR(vs.fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
        vs.created_at
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      JOIN core.firmante f ON f.numero_identificacion = sv.numero_identificacion
      WHERE f.id = $1
      ORDER BY vs.created_at DESC
    `,
        [firmante_id],
      );
      return res.json(rows);
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error obteniendo vacaciones", error: err.message });
    }
  },
);

// GET /api/permisos/bandeja-vacaciones
router.get(
  "/bandeja-vacaciones",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    try {
      const { rows } = await pool.query(
        `
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado, vs.created_at,
        vs.archivo_jefe, vs.archivo_superior, vs.archivo_uath,
        TO_CHAR(vs.fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
        sv.nombres AS servidor_nombre,
        sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      JOIN core.puesto p ON p.id = ap.puesto_id
      JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      WHERE (
        (vs.jefe_firmante_id = $1 AND vs.estado = 'PENDIENTE_JEFE') OR
        (vs.gerente_id = $1 AND vs.estado = 'PENDIENTE_GERENTE') OR
        (vs.uath_id = $1 AND vs.estado = 'PENDIENTE_UATH')
      )
      ORDER BY vs.created_at ASC
    `,
        [firmante_id],
      );
      return res.json(rows);
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error obteniendo bandeja", error: err.message });
    }
  },
);

// GET /api/permisos/reporte-vacaciones
router.get(
  "/reporte-vacaciones",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { fecha, estado } = req.query;
    try {
      let where = "WHERE 1=1";
      const values = [];
      let i = 1;

      if (fecha) {
        where += ` AND vs.fecha_solicitud = $${i}`;
        values.push(fecha);
        i++;
      }
      if (estado && estado !== "TODOS") {
        where += ` AND vs.estado = $${i}`;
        values.push(estado);
        i++;
      }

      const { rows } = await pool.query(
        `
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado, vs.archivo_uath,
        TO_CHAR(vs.fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
        sv.nombres AS servidor_nombre,
        sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica,
        fj.nombre AS jefe_nombre
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      LEFT JOIN core.firmante fj ON fj.id = vs.jefe_firmante_id
      ${where}
      ORDER BY vs.created_at DESC
    `,
        values,
      );

      return res.json({ total: rows.length, data: rows });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error obteniendo reporte", error: err.message });
    }
  },
);

// POST /api/permisos/solicitar-vacacion
router.post(
  "/solicitar-vacacion",
  requireAuth,
  requireServidor,
  async (req, res) => {
    const { servidor_id, unidad_organica_id } = req.user;
    const {
      tipo,
      fecha_inicio,
      fecha_fin,
      dias_solicitados,
      telefono_domicilio,
      telefono_movil,
    } = req.body;

    if (!tipo || !fecha_inicio || !fecha_fin || !dias_solicitados) {
      return res
        .status(400)
        .json({ message: "Todos los campos son requeridos" });
    }
    if (!["VACACION_PROGRAMADA", "PERMISO_CON_CARGO"].includes(tipo)) {
      return res.status(400).json({ message: "Tipo de solicitud inválido" });
    }
    if (new Date(fecha_fin) < new Date(fecha_inicio)) {
      return res
        .status(400)
        .json({ message: "La fecha fin debe ser posterior a la fecha inicio" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const pendienteR = await client.query(
        `
  SELECT id FROM core.vacacion_solicitud
  WHERE servidor_id = $1 AND estado NOT IN ('APROBADO', 'NEGADO') LIMIT 1
`,
        [servidor_id],
      );

      if (pendienteR.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message:
            "Tienes una solicitud de vacaciones en proceso. Espera la respuesta antes de solicitar otra.",
        });
      }

      const solapamientoR = await client.query(
        `
  SELECT id FROM core.vacacion_solicitud
  WHERE servidor_id = $1
    AND estado NOT IN ('NEGADO')
    AND fecha_inicio <= $3
    AND fecha_fin >= $2
  LIMIT 1
`,
        [servidor_id, fecha_inicio, fecha_fin],
      );

      if (solapamientoR.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message:
            "Ya tienes vacaciones aprobadas o en proceso en ese período de fechas.",
        });
      }

      const saldoR = await client.query(
        `
      SELECT horas_totales, horas_usadas FROM core.saldo_permiso WHERE servidor_id = $1
    `,
        [servidor_id],
      );

      if (!saldoR.rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "No tiene saldo asignado. Contacte a UATH." });
      }

      const horas_solicitadas = parseFloat(dias_solicitados) * 8;
      const disponibles =
        saldoR.rows[0].horas_totales - saldoR.rows[0].horas_usadas;

      if (horas_solicitadas > disponibles) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `Saldo insuficiente. Disponible: ${(disponibles / 8).toFixed(1)} días, Solicitado: ${dias_solicitados} días`,
        });
      }

      const unidadR = await client.query(
        `
      SELECT jefe_id, jefe_superior_id FROM core.unidad_organica WHERE id = $1
    `,
        [unidad_organica_id],
      );

      const jefe_firmante_id = unidadR.rows[0]?.jefe_id || null;
      const gerente_id = unidadR.rows[0]?.jefe_superior_id || null;

      const { rows } = await client.query(
        `
      INSERT INTO core.vacacion_solicitud
        (servidor_id, tipo, fecha_inicio, fecha_fin, dias_solicitados,
         jefe_firmante_id, gerente_id, telefono_domicilio, telefono_movil)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
        [
          servidor_id,
          tipo,
          fecha_inicio,
          fecha_fin,
          dias_solicitados,
          jefe_firmante_id,
          gerente_id,
          telefono_domicilio || null,
          telefono_movil || null,
        ],
      );

      await client.query("COMMIT");
      if (jefe_firmante_id) {
        await pool.query(
          `
    INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo)
    VALUES ($1, $2, 'NUEVA_SOLICITUD')
  `,
          [rows[0].id, jefe_firmante_id],
        );

        notifyCargoId(`permiso-firmante-${jefe_firmante_id}`, {
          tipo: "NUEVA_SOLICITUD",
          vacacion_id: rows[0].id,
          mensaje: "Nueva solicitud de vacaciones pendiente",
          es_vacacion: true,
        });
      }

      if (jefe_firmante_id) {
        notifyCargoId(`permiso-firmante-${jefe_firmante_id}`, {
          tipo: "NUEVA_SOLICITUD",
          solicitud_id: rows[0].id,
          mensaje: "Nueva solicitud de vacaciones pendiente",
        });
      }

      return res.status(201).json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error creando solicitud", error: err.message });
    } finally {
      client.release();
    }
  },
);

// POST /api/permisos/solicitar-vacacion-firmante
router.post(
  "/solicitar-vacacion-firmante",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    const {
      tipo,
      fecha_inicio,
      fecha_fin,
      dias_solicitados,
      telefono_domicilio,
      telefono_movil,
    } = req.body;

    if (!tipo || !fecha_inicio || !fecha_fin || !dias_solicitados) {
      return res
        .status(400)
        .json({ message: "Todos los campos son requeridos" });
    }
    if (new Date(fecha_fin) < new Date(fecha_inicio)) {
      return res
        .status(400)
        .json({ message: "La fecha fin debe ser posterior a la fecha inicio" });
    }

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
      WHERE f.id = $1 LIMIT 1
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

      const pendienteR = await client.query(
        `
  SELECT id FROM core.vacacion_solicitud
  WHERE servidor_id = $1 AND estado NOT IN ('APROBADO', 'NEGADO') LIMIT 1
`,
        [servidor_id],
      );

      if (pendienteR.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message:
            "Tienes una solicitud de vacaciones en proceso. Espera la respuesta antes de solicitar otra.",
        });
      }

      const solapamientoR = await client.query(
        `
  SELECT id FROM core.vacacion_solicitud
  WHERE servidor_id = $1
    AND estado NOT IN ('NEGADO')
    AND fecha_inicio <= $3
    AND fecha_fin >= $2
  LIMIT 1
`,
        [servidor_id, fecha_inicio, fecha_fin],
      );

      if (solapamientoR.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message:
            "Ya tienes vacaciones aprobadas o en proceso en ese período de fechas.",
        });
      }

      const saldoR = await client.query(
        `
      SELECT horas_totales, horas_usadas FROM core.saldo_permiso WHERE servidor_id = $1
    `,
        [servidor_id],
      );

      if (!saldoR.rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "No tiene saldo asignado. Contacte a UATH." });
      }

      const horas_solicitadas = parseFloat(dias_solicitados) * 8;
      const disponibles =
        saldoR.rows[0].horas_totales - saldoR.rows[0].horas_usadas;

      if (horas_solicitadas > disponibles) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `Saldo insuficiente. Disponible: ${(disponibles / 8).toFixed(1)} días, Solicitado: ${dias_solicitados} días`,
        });
      }

      // Obtener jefe_id y jefe_superior_id de la unidad
      const unidadR = await client.query(
        `
  SELECT jefe_id, jefe_superior_id FROM core.unidad_organica WHERE id = $1
`,
        [unidad_organica_id],
      );

      const jefe_id_raw = unidadR.rows[0]?.jefe_id || null;
      const jefe_superior_id = unidadR.rows[0]?.jefe_superior_id || null;

      // Si el firmante ES su propio jefe inmediato → saltar al superior
      const esPropio = jefe_id_raw === firmante_id;

      const jefe_firmante_id = esPropio ? jefe_superior_id : jefe_id_raw;

      // Para el gerente: buscar quién es el jefe superior del jefe_firmante_id
      // Buscamos en qué unidad el jefe_firmante_id es jefe_id, y traemos su jefe_superior_id
      let gerente_id_final = null;

      if (!esPropio) {
        // Caso normal: jefe_firmante_id es el jefe_id de la unidad
        // El gerente es el jefe_superior_id de la unidad donde jefe_firmante_id es jefe_id
        const gerenteR = await client.query(
          `
    SELECT jefe_superior_id AS gerente_id
    FROM core.unidad_organica
    WHERE jefe_id = $1
    LIMIT 1
  `,
          [jefe_firmante_id],
        );
        gerente_id_final =
          gerenteR.rows[0]?.gerente_id || jefe_superior_id || null;
      } else {
        // esPropio: saltamos al superior, el gerente sería el jefe superior del superior
        const gerenteR = await client.query(
          `
    SELECT jefe_superior_id AS gerente_id
    FROM core.unidad_organica
    WHERE jefe_id = $1
    LIMIT 1
  `,
          [jefe_superior_id],
        );
        gerente_id_final = gerenteR.rows[0]?.gerente_id || null;
      }
      const { rows } = await client.query(
        `
  INSERT INTO core.vacacion_solicitud
    (servidor_id, tipo, fecha_inicio, fecha_fin, dias_solicitados,
     jefe_firmante_id, gerente_id, telefono_domicilio, telefono_movil)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING *
`,
        [
          servidor_id,
          tipo,
          fecha_inicio,
          fecha_fin,
          dias_solicitados,
          jefe_firmante_id,
          gerente_id_final,
          telefono_domicilio || null,
          telefono_movil || null,
        ],
      );

      await client.query("COMMIT");

      if (jefe_firmante_id) {
        await pool.query(
          `
    INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo)
    VALUES ($1, $2, 'NUEVA_SOLICITUD')
  `,
          [rows[0].id, jefe_firmante_id],
        );

        notifyCargoId(`permiso-firmante-${jefe_firmante_id}`, {
          tipo: "NUEVA_SOLICITUD",
          vacacion_id: rows[0].id,
          mensaje: "Nueva solicitud de vacaciones pendiente",
          es_vacacion: true,
        });
      }

      return res.status(201).json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error creando solicitud", error: err.message });
    } finally {
      client.release();
    }
  },
);

// ═══════════════════════════════════════════════════════════════
// RUTAS CON PARÁMETROS AL FINAL
// ═══════════════════════════════════════════════════════════════

// GET /api/permisos/:id/pdf-vacacion
router.get("/:id/pdf-vacacion", generarPdfVacacion);

// PUT /api/permisos/:id/cancelar-vacacion
router.put(
  "/:id/cancelar-vacacion",
  requireAuth,
  requireServidor,
  async (req, res) => {
    const { servidor_id } = req.user;
    const { id } = req.params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const solicitudR = await client.query(
        `
      SELECT id, estado, servidor_id FROM core.vacacion_solicitud WHERE id = $1
    `,
        [id],
      );

      if (!solicitudR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Solicitud no encontrada" });
      }

      const solicitud = solicitudR.rows[0];

      if (solicitud.servidor_id !== servidor_id) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "No autorizado" });
      }
      if (solicitud.estado === "APROBADO") {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ message: "No se puede cancelar una solicitud ya aprobada" });
      }

      await client.query(
        `DELETE FROM core.notificacion_permiso WHERE vacacion_solicitud_id = $1`,
        [id],
      );

      await client.query(`DELETE FROM core.vacacion_solicitud WHERE id = $1`, [
        id,
      ]);

      await client.query(`DELETE FROM core.vacacion_solicitud WHERE id = $1`, [
        id,
      ]);

      await client.query("COMMIT");
      return res.json({ message: "Solicitud cancelada correctamente" });
    } catch (err) {
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error cancelando", error: err.message });
    } finally {
      client.release();
    }
  },
);

// PUT /api/permisos/:id/cancelar-vacacion-firmante
router.put(
  "/:id/cancelar-vacacion-firmante",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    const { id } = req.params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const svR = await client.query(
        `
      SELECT sv.id AS servidor_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE f.id = $1 LIMIT 1
    `,
        [firmante_id],
      );

      if (!svR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Servidor no encontrado" });
      }

      const solicitudR = await client.query(
        `
      SELECT id, estado, servidor_id FROM core.vacacion_solicitud WHERE id = $1
    `,
        [id],
      );

      if (!solicitudR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Solicitud no encontrada" });
      }

      const solicitud = solicitudR.rows[0];

      if (solicitud.servidor_id !== svR.rows[0].servidor_id) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "No autorizado" });
      }
      if (solicitud.estado === "APROBADO") {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ message: "No se puede cancelar una solicitud ya aprobada" });
      }
      await client.query(
        ` DELETE FROM core.notificacion_permiso WHERE vacacion_solicitud_id = $1`,
        [id],
      );

      await client.query(`DELETE FROM core.vacacion_solicitud WHERE id = $1`, [
        id,
      ]);

      await client.query(`DELETE FROM core.vacacion_solicitud WHERE id = $1`, [
        id,
      ]);

      await client.query("COMMIT");
      return res.json({ message: "Solicitud cancelada correctamente" });
    } catch (err) {
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error cancelando", error: err.message });
    } finally {
      client.release();
    }
  },
);

// PUT /api/permisos/:id/responder-vacacion
router.put(
  "/:id/responder-vacacion",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { id } = req.params;
    const { aprobado, observacion } = req.body;
    const { firmante_id } = req.user;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const solicitudR = await client.query(
        `SELECT * FROM core.vacacion_solicitud WHERE id = $1`,
        [id],
      );

      if (!solicitudR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Solicitud no encontrada" });
      }

      const solicitud = solicitudR.rows[0];
      const esJefe =
        solicitud.jefe_firmante_id === firmante_id &&
        solicitud.estado === "PENDIENTE_JEFE";
      const esGerente =
        solicitud.gerente_id === firmante_id &&
        solicitud.estado === "PENDIENTE_GERENTE";
      const esUath =
        solicitud.uath_id === firmante_id &&
        solicitud.estado === "PENDIENTE_UATH";

      if (!esJefe && !esGerente && !esUath) {
        await client.query("ROLLBACK");
        return res
          .status(403)
          .json({ message: "No autorizado para responder esta solicitud" });
      }

      // Validar que no apruebe dos pasos
      if (esGerente && solicitud.jefe_firmante_id === firmante_id) {
        await client.query("ROLLBACK");
        return res
          .status(403)
          .json({ message: "No puedes aprobar en dos pasos del mismo flujo" });
      }

      if (!aprobado) {
        await client.query(
          `
        UPDATE core.vacacion_solicitud
        SET estado = 'NEGADO',
            observacion_jefe = CASE WHEN $2 THEN $3 ELSE observacion_jefe END,
            observacion_gerente = CASE WHEN $4 THEN $3 ELSE observacion_gerente END,
            fecha_respuesta_jefe = CASE WHEN $2 THEN NOW() ELSE fecha_respuesta_jefe END,
            fecha_respuesta_gerente = CASE WHEN $4 THEN NOW() ELSE fecha_respuesta_gerente END
        WHERE id = $1
      `,
          [id, esJefe, observacion || null, esGerente],
        );
      } else if (esJefe) {
        const nuevoEstado = solicitud.gerente_id
          ? "PENDIENTE_GERENTE"
          : "PENDIENTE_UATH";
        let uath_id = null;
        if (!solicitud.gerente_id) {
          const uathR = await client.query(`
          SELECT f.id FROM core.firmante f
          JOIN core.cargo c ON c.id = f.cargo_id
          WHERE c.nombre = 'RESPONSABLE DE LA UATH' AND f.activo = true LIMIT 1
        `);
          uath_id = uathR.rows[0]?.id || null;
        }
        await client.query(
          `
        UPDATE core.vacacion_solicitud
        SET estado = $2, observacion_jefe = $3, fecha_respuesta_jefe = NOW(),
            uath_id = COALESCE($4, uath_id)
        WHERE id = $1
      `,
          [id, nuevoEstado, observacion || null, uath_id],
        );
      } else if (esGerente) {
        const horas = parseFloat(solicitud.dias_solicitados) * 8;

        await client.query(
          `
        UPDATE core.saldo_permiso SET horas_usadas = horas_usadas + $1, updated_at = NOW()
        WHERE servidor_id = $2
      `,
          [horas, solicitud.servidor_id],
        );

        await client.query(
          `
        INSERT INTO core.permiso_movimiento (servidor_id, horas, tipo, descripcion, creado_por)
        VALUES ($1, $2, 'DESCUENTO', 'Vacaciones aprobadas por jefe superior', $3)
      `,
          [solicitud.servidor_id, horas, firmante_id],
        );

        const uathR = await client.query(`
        SELECT f.id FROM core.firmante f
        JOIN core.cargo c ON c.id = f.cargo_id
        WHERE c.nombre IN ('ASISTENTE DE LA UATH', 'RESPONSABLE DE LA UATH') AND f.activo = true
        ORDER BY c.nombre DESC LIMIT 1
      `);
        const uath_id = uathR.rows[0]?.id || null;

        await client.query(
          `
        UPDATE core.vacacion_solicitud
        SET estado = 'PENDIENTE_UATH', observacion_gerente = $2,
            fecha_respuesta_gerente = NOW(), uath_id = $3
        WHERE id = $1
      `,
          [id, observacion || null, uath_id],
        );
      } else if (esUath) {
        await client.query(
          `
        UPDATE core.vacacion_solicitud
        SET estado = 'APROBADO', observacion_uath = $2,
            fecha_respuesta_uath = NOW(), uath_id = $3
        WHERE id = $1
      `,
          [id, observacion || null, firmante_id],
        );
      }

      await client.query("COMMIT");

      const firmanteVinculadoR = await pool.query(
        `
      SELECT f.id AS firmante_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE sv.id = $1 LIMIT 1
    `,
        [solicitud.servidor_id],
      );

      const firmanteVinculado = firmanteVinculadoR.rows[0]?.firmante_id || null;
      const estadoFinal = aprobado
        ? esUath
          ? "APROBADO"
          : "EN_PROCESO"
        : "NEGADO";

      if (estadoFinal !== "EN_PROCESO") {
        if (firmanteVinculado) {
          notifyCargoId(`permiso-firmante-${firmanteVinculado}`, {
            tipo: estadoFinal,
            mensaje:
              estadoFinal === "APROBADO"
                ? "Tus vacaciones fueron aprobadas"
                : "Tu solicitud de vacaciones fue negada",
          });
        } else {
          notifyCargoId(`permiso-servidor-${solicitud.servidor_id}`, {
            tipo: estadoFinal,
            mensaje:
              estadoFinal === "APROBADO"
                ? "Tus vacaciones fueron aprobadas"
                : "Tu solicitud de vacaciones fue negada",
          });
        }
      }

      return res.json({ message: "Solicitud procesada correctamente" });
    } catch (err) {
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error procesando solicitud", error: err.message });
    } finally {
      client.release();
    }
  },
);

// POST /api/permisos/:id/subir-firma-jefe
router.post(
  "/:id/subir-firma-jefe",
  requireAuth,
  requireFirmante,
  upload.single("file"),
  async (req, res) => {
    const { id } = req.params;
    const { firmante_id } = req.user;

    if (!req.file)
      return res.status(400).json({ message: "Archivo PDF requerido" });

    const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
    const rel = path.relative(uploadsBase, req.file.path).replaceAll("\\", "/");
    const archivoPath = `/uploads/${rel}`;

    try {
      const solicitudR = await pool.query(
        `SELECT * FROM core.vacacion_solicitud WHERE id = $1`,
        [id],
      );
      if (!solicitudR.rows.length)
        return res.status(404).json({ message: "Solicitud no encontrada" });
      const solicitud = solicitudR.rows[0];

      if (solicitud.jefe_firmante_id !== firmante_id)
        return res.status(403).json({ message: "No autorizado" });
      if (solicitud.estado !== "PENDIENTE_JEFE")
        return res
          .status(409)
          .json({ message: "Esta solicitud no está pendiente de jefe" });

      // Solo guardar archivo, NO cambiar estado
      await pool.query(
        `
      UPDATE core.vacacion_solicitud SET archivo_jefe = $1 WHERE id = $2
    `,
        [archivoPath, id],
      );

      return res.json({
        message: "PDF guardado correctamente",
        archivo: archivoPath,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error subiendo firma", error: err.message });
    }
  },
);

// POST /:id/confirmar-firma-jefe → avanza estado
router.post(
  "/:id/confirmar-firma-jefe",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { id } = req.params;
    const { firmante_id } = req.user;

    try {
      const solicitudR = await pool.query(
        `SELECT * FROM core.vacacion_solicitud WHERE id = $1`,
        [id],
      );
      if (!solicitudR.rows.length)
        return res.status(404).json({ message: "Solicitud no encontrada" });
      const solicitud = solicitudR.rows[0];

      if (solicitud.jefe_firmante_id !== firmante_id)
        return res.status(403).json({ message: "No autorizado" });
      if (solicitud.estado !== "PENDIENTE_JEFE")
        return res
          .status(409)
          .json({ message: "Esta solicitud no está pendiente de jefe" });
      if (!solicitud.archivo_jefe)
        return res
          .status(400)
          .json({ message: "Debes subir el PDF firmado antes de confirmar" });

      const nuevoEstado = solicitud.gerente_id
        ? "PENDIENTE_GERENTE"
        : "PENDIENTE_UATH";
      let uath_id = null;
      if (!solicitud.gerente_id) {
        const uathR = await pool.query(`
        SELECT f.id FROM core.firmante f
        JOIN core.cargo c ON c.id = f.cargo_id
        WHERE c.nombre = 'RESPONSABLE DE LA UATH' AND f.activo = true LIMIT 1
      `);
        uath_id = uathR.rows[0]?.id || null;
      }

      // Agregar en confirmar-firma-jefe antes del UPDATE de estado:
      const horas = parseFloat(solicitud.dias_solicitados) * 8;
      await pool.query(
        `UPDATE core.saldo_permiso SET horas_usadas = horas_usadas + $1, updated_at = NOW() WHERE servidor_id = $2`,
        [horas, solicitud.servidor_id],
      );

      await pool.query(
        `INSERT INTO core.permiso_movimiento (servidor_id, horas, tipo, descripcion, creado_por) 
          VALUES ($1, $2, 'DESCUENTO', 'Vacaciones aprobadas por jefe inmediato', $3)`,
        [solicitud.servidor_id, horas, firmante_id],
      );

      await pool.query(
        `
      UPDATE core.vacacion_solicitud
      SET estado = $1, fecha_respuesta_jefe = NOW(),
          uath_id = COALESCE($2, uath_id)
      WHERE id = $3
    `,
        [nuevoEstado, uath_id, id],
      );

      const notificarId = solicitud.gerente_id || uath_id;
      if (notificarId) {
        await pool.query(
          `
        INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo)
        VALUES ($1, $2, 'NUEVA_SOLICITUD')
      `,
          [id, notificarId],
        );
        notifyCargoId(`permiso-firmante-${notificarId}`, {
          tipo: "NUEVA_SOLICITUD",
          vacacion_id: id,
          mensaje: "Solicitud de vacaciones pendiente de tu aprobación",
          es_vacacion: true,
        });
      }

      return res.json({ message: "Solicitud enviada al siguiente paso" });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error confirmando firma", error: err.message });
    }
  },
);

// POST /:id/subir-firma-superior → solo guarda el archivo, NO cambia estado
router.post(
  "/:id/subir-firma-superior",
  requireAuth,
  requireFirmante,
  upload.single("file"),
  async (req, res) => {
    const { id } = req.params;
    const { firmante_id } = req.user;

    if (!req.file)
      return res.status(400).json({ message: "Archivo PDF requerido" });

    const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
    const rel = path.relative(uploadsBase, req.file.path).replaceAll("\\", "/");
    const archivoPath = `/uploads/${rel}`;

    try {
      const solicitudR = await pool.query(
        `SELECT * FROM core.vacacion_solicitud WHERE id = $1`,
        [id],
      );
      if (!solicitudR.rows.length)
        return res.status(404).json({ message: "Solicitud no encontrada" });
      const solicitud = solicitudR.rows[0];

      if (solicitud.jefe_firmante_id === firmante_id)
        return res.status(403).json({
          message:
            "No puedes aprobar tu propia solicitud en dos pasos del flujo",
        });
      if (solicitud.gerente_id !== firmante_id)
        return res.status(403).json({ message: "No autorizado" });
      if (solicitud.estado !== "PENDIENTE_GERENTE")
        return res.status(409).json({
          message: "Esta solicitud no está pendiente de jefe superior",
        });

      // Solo guardar archivo, NO cambiar estado
      await pool.query(
        `
      UPDATE core.vacacion_solicitud SET archivo_superior = $1 WHERE id = $2
    `,
        [archivoPath, id],
      );

      return res.json({
        message: "PDF guardado correctamente",
        archivo: archivoPath,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error subiendo firma", error: err.message });
    }
  },
);

// POST /:id/confirmar-firma-superior → descuenta saldo y avanza estado
router.post(
  "/:id/confirmar-firma-superior",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { id } = req.params;
    const { firmante_id } = req.user;

    try {
      const solicitudR = await pool.query(
        `SELECT * FROM core.vacacion_solicitud WHERE id = $1`,
        [id],
      );
      if (!solicitudR.rows.length)
        return res.status(404).json({ message: "Solicitud no encontrada" });
      const solicitud = solicitudR.rows[0];

      if (solicitud.jefe_firmante_id === firmante_id)
        return res.status(403).json({
          message:
            "No puedes aprobar tu propia solicitud en dos pasos del flujo",
        });
      if (solicitud.gerente_id !== firmante_id)
        return res.status(403).json({ message: "No autorizado" });
      if (solicitud.estado !== "PENDIENTE_GERENTE")
        return res.status(409).json({
          message: "Esta solicitud no está pendiente de jefe superior",
        });
      if (!solicitud.archivo_superior)
        return res
          .status(400)
          .json({ message: "Debes subir el PDF firmado antes de confirmar" });

      // Obtener UATH
      const uathR = await pool.query(`
      SELECT f.id FROM core.firmante f
      JOIN core.cargo c ON c.id = f.cargo_id
      WHERE c.nombre = 'RESPONSABLE DE LA UATH' AND f.activo = true LIMIT 1
    `);
      const uath_id = uathR.rows[0]?.id || null;

      await pool.query(
        `
      UPDATE core.vacacion_solicitud
      SET estado = 'PENDIENTE_UATH', fecha_respuesta_gerente = NOW(), uath_id = $1
      WHERE id = $2
    `,
        [uath_id, id],
      );

      if (uath_id) {
        await pool.query(
          `
        INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo)
        VALUES ($1, $2, 'NUEVA_SOLICITUD')
      `,
          [id, uath_id],
        );
        notifyCargoId(`permiso-firmante-${uath_id}`, {
          tipo: "NUEVA_SOLICITUD",
          vacacion_id: id,
          mensaje: "Solicitud de vacaciones pendiente de certificación UATH",
          es_vacacion: true,
        });
      }

      return res.json({ message: "Solicitud enviada a UATH" });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error confirmando firma", error: err.message });
    }
  },
);

// POST /:id/subir-firma-uath → solo guarda el archivo, NO cambia estado
router.post(
  "/:id/subir-firma-uath",
  requireAuth,
  requireFirmante,
  upload.single("file"),
  async (req, res) => {
    const { id } = req.params;
    const { firmante_id } = req.user;

    if (!req.file)
      return res.status(400).json({ message: "Archivo PDF requerido" });

    const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
    const rel = path.relative(uploadsBase, req.file.path).replaceAll("\\", "/");
    const archivoPath = `/uploads/${rel}`;

    try {
      const solicitudR = await pool.query(
        `SELECT * FROM core.vacacion_solicitud WHERE id = $1`,
        [id],
      );
      if (!solicitudR.rows.length)
        return res.status(404).json({ message: "Solicitud no encontrada" });
      const solicitud = solicitudR.rows[0];

      if (
        solicitud.jefe_firmante_id === firmante_id ||
        solicitud.gerente_id === firmante_id
      )
        return res.status(403).json({
          message:
            "No puedes certificar una solicitud que ya aprobaste en pasos anteriores",
        });
      if (solicitud.uath_id !== firmante_id)
        return res.status(403).json({ message: "No autorizado" });
      if (solicitud.estado !== "PENDIENTE_UATH")
        return res
          .status(409)
          .json({ message: "Esta solicitud no está pendiente de UATH" });

      // Solo guardar archivo, NO cambiar estado
      await pool.query(
        `
      UPDATE core.vacacion_solicitud SET archivo_uath = $1 WHERE id = $2
    `,
        [archivoPath, id],
      );

      return res.json({
        message: "PDF guardado correctamente",
        archivo: archivoPath,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error subiendo firma UATH", error: err.message });
    }
  },
);

// POST /:id/confirmar-firma-uath → aprueba y notifica
router.post(
  "/:id/confirmar-firma-uath",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { id } = req.params;
    const { firmante_id } = req.user;

    try {
      const solicitudR = await pool.query(
        `SELECT * FROM core.vacacion_solicitud WHERE id = $1`,
        [id],
      );
      if (!solicitudR.rows.length)
        return res.status(404).json({ message: "Solicitud no encontrada" });
      const solicitud = solicitudR.rows[0];

      if (
        solicitud.jefe_firmante_id === firmante_id ||
        solicitud.gerente_id === firmante_id
      )
        return res.status(403).json({
          message:
            "No puedes certificar una solicitud que ya aprobaste en pasos anteriores",
        });
      if (solicitud.uath_id !== firmante_id)
        return res.status(403).json({ message: "No autorizado" });
      if (solicitud.estado !== "PENDIENTE_UATH")
        return res
          .status(409)
          .json({ message: "Esta solicitud no está pendiente de UATH" });
      if (!solicitud.archivo_uath)
        return res
          .status(400)
          .json({ message: "Debes subir el PDF firmado antes de confirmar" });

      await pool.query(
        `
      UPDATE core.vacacion_solicitud
      SET estado = 'APROBADO', fecha_respuesta_uath = NOW(), uath_id = $1
      WHERE id = $2
    `,
        [firmante_id, id],
      );

      const firmanteVinculadoR = await pool.query(
        `
      SELECT f.id AS firmante_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE sv.id = $1 LIMIT 1
    `,
        [solicitud.servidor_id],
      );

      const firmanteVinculado = firmanteVinculadoR.rows[0]?.firmante_id || null;

      if (firmanteVinculado) {
        await pool.query(
          `
        INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo)
        VALUES ($1, $2, 'APROBADO')
      `,
          [id, firmanteVinculado],
        );
        notifyCargoId(`permiso-firmante-${firmanteVinculado}`, {
          tipo: "APROBADO",
          vacacion_id: id,
          mensaje: "Tus vacaciones fueron aprobadas y certificadas",
          es_vacacion: true,
        });
      } else {
        await pool.query(
          `
        INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, servidor_id, tipo)
        VALUES ($1, $2, 'APROBADO')
      `,
          [id, solicitud.servidor_id],
        );
        notifyCargoId(`permiso-servidor-${solicitud.servidor_id}`, {
          tipo: "APROBADO",
          vacacion_id: id,
          mensaje: "Tus vacaciones fueron aprobadas y certificadas",
          es_vacacion: true,
        });
      }

      return res.json({ message: "Vacaciones certificadas correctamente" });
    } catch (err) {
      return res.status(500).json({
        message: "Error confirmando certificación",
        error: err.message,
      });
    }
  },
);
// GET /api/permisos/:id/descargar-vacacion/:tipo
router.get(
  "/:id/descargar-vacacion/:tipo",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { id, tipo } = req.params;
    const colMap = {
      jefe: "archivo_jefe",
      superior: "archivo_superior",
      uath: "archivo_uath",
      base: null,
    };

    if (!Object.prototype.hasOwnProperty.call(colMap, tipo)) {
      return res
        .status(400)
        .json({ message: "Tipo inválido. Usa: jefe, superior, uath, base" });
    }

    try {
      if (tipo === "base")
        return res.redirect(`/api/permisos/${id}/pdf-vacacion`);

      const col = colMap[tipo];
      const { rows } = await pool.query(
        `SELECT ${col} AS archivo FROM core.vacacion_solicitud WHERE id = $1`,
        [id],
      );

      if (!rows.length || !rows[0].archivo)
        return res.status(404).json({ message: "Archivo no encontrado" });

      const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
      const filePath = path.join(
        uploadsBase,
        rows[0].archivo.replace("/uploads/", ""),
      );

      if (!fs.existsSync(filePath))
        return res
          .status(404)
          .json({ message: "Archivo no encontrado en el servidor" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=vacacion_${tipo}_${id}.pdf`,
      );
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error descargando archivo", error: err.message });
    }
  },
);

export default router;
