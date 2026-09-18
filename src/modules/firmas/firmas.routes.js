import { Router } from "express";
import {
  requireAuth,
  requireFirmante,
} from "../../shared/middleware/auth.middleware.js";
import {
  misFirmasPendientes,
  listarFirmasAccion,
  firmaPendienteAccion,
  eliminarFirma,
} from "./firmas.controller.js";
import { firmarPdfAccionConP12 } from "../../shared/utils/firmarPdf.service.js";
import { generarPdfAccionBuffer } from "../acciones/accionesPdf.controller.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { pool } from "../../db.js";
import { notifyCargoId, notifyServidorId } from "../../shared/utils/sseManager.js";
import { cargoIdsEquivalentes } from "../../shared/constants/cargos.js";
import { resolverServidorPropio } from "../../shared/utils/resolverServidorPropio.js";
import { notificarRecepcionPendiente } from "../../shared/utils/notificarRecepcion.js";

const router = Router();
router.get("/pendientes", requireAuth, misFirmasPendientes);
router.get("/acciones/:accionId", requireAuth, listarFirmasAccion);
router.get("/acciones/:accionId/pendiente", requireAuth, firmaPendienteAccion);
router.delete(
  "/acciones/:accionId/firmas/:firmaId",
  requireAuth,
  eliminarFirma,
);

//RUTAS NUEVAS (certificado p12)
// El certificado propio aplica tanto a firmantes institucionales
// (core.firmante) como, desde la firma de recepción, a servidores
// (core.servidor) — mismas columnas p12_path/p12_activo en ambas tablas.
// tabla/columna id según quién esté autenticado, sin bifurcar el resto
// de la lógica (multer, validaciones, mensajes) que ya estaba probada.
const tablaCertificado = (req) =>
  req.user.tipo_usuario === "SERVIDOR"
    ? { tabla: "core.servidor", id: req.user.servidor_id }
    : { tabla: "core.firmante", id: req.user.firmante_id };

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve(
      process.env.UPLOADS_DIR || "uploads",
      "certificados",
    );
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const { id } = tablaCertificado(req);
    cb(null, `${id}.p12`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.originalname.endsWith(".p12")) {
      return cb(new Error("Solo se permiten archivos .p12"));
    }
    cb(null, true);
  },
});

// POST /api/firmas/subir-p12
router.post(
  "/subir-p12",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    const { tabla, id } = tablaCertificado(req);
    if (!id)
      return res.status(403).json({ message: "Usuario no reconocido" });
    if (!req.file)
      return res.status(400).json({ message: "Archivo .p12 requerido" });

    const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
    const rel = path.relative(uploadsBase, req.file.path).replaceAll("\\", "/");
    const p12Path = `/uploads/${rel}`;

    try {
      await pool.query(
        `UPDATE ${tabla} SET p12_path = $1, p12_activo = true WHERE id = $2`,
        [p12Path, id],
      );
      return res.json({
        message: "Certificado subido correctamente",
        p12_path: p12Path,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error guardando certificado", error: err.message });
    }
  },
);

// GET /api/firmas/mi-certificado
router.get("/mi-certificado", requireAuth, async (req, res) => {
  const { tabla, id } = tablaCertificado(req);
  if (!id) return res.status(403).json({ message: "Usuario no reconocido" });
  try {
    const { rows } = await pool.query(
      `SELECT p12_path, p12_activo FROM ${tabla} WHERE id = $1`,
      [id],
    );
    return res.json({
      tiene_certificado: !!rows[0]?.p12_path,
      p12_activo: rows[0]?.p12_activo || false,
    });
  } catch (err) {
    return res.status(500).json({ message: "Error", error: err.message });
  }
});

// POST /api/firmas/acciones/:accionId/firmar
router.post(
  "/acciones/:accionId/firmar",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { accionId } = req.params;
    const { firmante_id, cargo_id } = req.user;
    const { password } = req.body;

    if (!password)
      return res
        .status(400)
        .json({ message: "Contraseña del token requerida" });

    try {
      // 1. Obtener la firma pendiente del firmante actual
      const firmaR = await pool.query(
        `
      SELECT af.*, taf.rol_firma, taf.orden
      FROM core.accion_firma af
      JOIN core.tipo_accion_firma taf ON taf.tipo_accion_id = (
        SELECT tipo_accion_id FROM core.accion_personal WHERE id = $1
      ) AND taf.rol_firma = af.rol_firma AND taf.orden = af.orden
      WHERE af.accion_id = $1
        AND af.cargo_id = ANY($2)
        AND af.estado = 'PENDIENTE'
      ORDER BY af.orden ASC
      LIMIT 1
    `,
        [accionId, cargoIdsEquivalentes(cargo_id)],
      );

      if (!firmaR.rows.length)
        return res
          .status(404)
          .json({ message: "No tienes una firma pendiente en esta acción" });

      const firma = firmaR.rows[0];
      const rolFirma = firma.rol_firma.toLowerCase();

      // 2. Mapear rol a posición y columna
      const rolMap = {
        elabora: { posicion: "elabora", columna: "archivo_elabora" },
        registra_controla: {
          posicion: "registra_controla",
          columna: "archivo_registra",
        },
        revisa: { posicion: "revisa", columna: "archivo_revisa" },
        aprueba_th: { posicion: "aprueba_th", columna: "archivo_aprueba_th" },
        aprueba_autoridad: {
          posicion: "aprueba_autoridad",
          columna: "archivo_aprueba_autoridad",
        },
      };

      const mapeo = rolMap[rolFirma];
      if (!mapeo)
        return res
          .status(400)
          .json({ message: `Rol desconocido: ${rolFirma}` });

      // 3. Verificar que tiene p12
      const p12R = await pool.query(
        `SELECT p12_path, p12_activo FROM core.firmante WHERE id = $1`,
        [firmante_id],
      );
      if (!p12R.rows[0]?.p12_path || !p12R.rows[0]?.p12_activo)
        return res.status(400).json({
          message:
            "No tienes un certificado digital registrado. Ve a Configuración > Mi Certificado",
        });

      const p12FullPath = path.resolve(
        process.env.UPLOADS_DIR || "uploads",
        p12R.rows[0].p12_path.replace("/uploads/", ""),
      );

      // 4. Obtener datos del firmante
      const firmanteR = await pool.query(
        `
      SELECT f.nombre, c.nombre AS cargo
      FROM core.firmante f
      JOIN core.cargo c ON c.id = f.cargo_id
      WHERE f.id = $1
    `,
        [firmante_id],
      );

      const { nombre, cargo } = firmanteR.rows[0];

      // 5. Obtener PDF base — tomar el último archivo firmado disponible
      const accionR = await pool.query(
        `
      SELECT archivo_elabora, archivo_registra, archivo_revisa,
             archivo_aprueba_th, archivo_aprueba_autoridad
      FROM core.accion_personal WHERE id = $1
    `,
        [accionId],
      );

      const accion = accionR.rows[0];
      const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");

      // Tomar el PDF del paso anterior como base
      const ordenArchivos = [
        accion.archivo_aprueba_th,
        accion.archivo_revisa,
        accion.archivo_registra,
        accion.archivo_elabora,
      ];

      let pdfBuffer;
      const archivoBase = ordenArchivos.find((a) => !!a);

      if (archivoBase) {
        const filePath = path.resolve(
          uploadsBase,
          archivoBase.replace("/uploads/", ""),
        );
        pdfBuffer = fs.readFileSync(filePath);
      } else {
        // Primer paso — generar PDF base
        pdfBuffer = await generarPdfAccionBuffer(accionId, firmante_id);
      }

      // 6. Firmar con p12
      let signedPdf;
      try {
        signedPdf = await firmarPdfAccionConP12({
          pdfInputBuffer: pdfBuffer,
          p12Path: p12FullPath,
          p12Password: password,
          firmante: nombre,
          cargo,
          posicion: mapeo.posicion,
        });
      } catch (err) {
        if (
          err.message?.includes("password") ||
          err.message?.includes("passphrase")
        )
          return res
            .status(400)
            .json({ message: "Contraseña del token incorrecta" });
        throw err;
      }

      // 7. Guardar PDF firmado
      const codigoR = await pool.query(
        `SELECT codigo_elaboracion FROM core.accion_personal WHERE id = $1`,
        [accionId],
      );
      const codigo = codigoR.rows[0]?.codigo_elaboracion || accionId;
      const dir = path.resolve(
        uploadsBase,
        "acciones",
        codigo,
        "firmas",
        rolFirma,
      );
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filename = `firmado_${Date.now()}.pdf`;
      const filePath = path.join(dir, filename);
      fs.writeFileSync(filePath, signedPdf);
      const archivoPath = `/uploads/${path.relative(uploadsBase, filePath).replaceAll("\\", "/")}`;

      // 8. Actualizar BD — guardar archivo y marcar firma como FIRMADO
      await pool.query(
        `
      UPDATE core.accion_personal SET ${mapeo.columna} = $1 WHERE id = $2
    `,
        [archivoPath, accionId],
      );

      await pool.query(
        `
      UPDATE core.accion_firma
      SET estado = 'FIRMADO', firmado_en = NOW(), firmante_id = $1
      WHERE id = $2
    `,
        [firmante_id, firma.id],
      );

      // 9. Recalcular estado de la acción. El paso RECIBIDO (recepción del
      // servidor) no cuenta para esto: la acción queda "APROBADO" en cuanto
      // termina la cadena institucional (UATH + Gerente), igual que antes
      // de que existiera ese paso — la recepción se registra aparte y
      // nunca vuelve a tocar este campo (ver /firmar-recepcion).
      const estadoR = await pool.query(
        `
      UPDATE core.accion_personal ap
      SET estado = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM core.accion_firma af
          WHERE af.accion_id = ap.id
            AND af.estado = 'PENDIENTE'
            AND af.rol_firma != 'RECIBIDO'
        ) THEN 'APROBADO'
        ELSE 'EN_FIRMA'
      END
      WHERE ap.id = $1
      RETURNING estado
    `,
        [accionId],
      );

      // 9b. Si con esta firma la cadena institucional quedó completa,
      // avisar al servidor (correo + SSE) de que ya puede firmar su
      // recepción — no bloquea la respuesta si algo falla aquí.
      if (estadoR.rows[0]?.estado === "APROBADO") {
        notificarRecepcionPendiente(accionId);
      }

      // 10. Notificar al siguiente firmante. El paso RECIBIDO no es "por
      // cargo" (cargo_id es NULL), así que no aplica esta notificación por
      // SSE/cargo — el servidor ve su acción pendiente al entrar a "Mis
      // Acciones de Personal".
      const siguienteR = await pool.query(
        `SELECT af.cargo_id, af.orden, af.rol_firma
          FROM core.accion_firma af
        WHERE af.accion_id = $1 AND af.estado = 'PENDIENTE'
          AND af.rol_firma != 'RECIBIDO'
          ORDER BY af.orden ASC
        LIMIT 1`,
        [accionId],
      );

      if (siguienteR.rows.length > 0) {
        const siguiente = siguienteR.rows[0];

        // Insertar notificación
        await pool.query(
          `INSERT INTO core.notificacion_firma (accion_id, cargo_id, rol_firma, orden)
            VALUES ($1, $2, $3, $4)`,
          [accionId, siguiente.cargo_id, siguiente.rol_firma, siguiente.orden],
        );

        // Notificar por SSE
        notifyCargoId(`firma-${siguiente.cargo_id}`, {
          tipo: "NUEVA_FIRMA",
          accion_id: accionId,
          mensaje: "Tienes una nueva acción de personal pendiente de firma",
        });
      }

      return res.json({
        message: "Acción firmada digitalmente",
        archivo: archivoPath,
        rol: rolFirma,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error firmando acción", error: err.message });
    }
  },
);

// GET /api/firmas/recepciones — acciones de personal del servidor
// "propio" del usuario autenticado (ver resolverServidorPropio) que
// tienen (o ya tuvieron) el paso RECIBIDO, tanto pendientes como ya
// firmadas.
router.get("/recepciones", requireAuth, async (req, res) => {
  const { servidorId: servidor_id } = await resolverServidorPropio(req);
  if (!servidor_id) return res.json([]);
  try {
    const { rows } = await pool.query(
      `
      SELECT
        ap.id AS accion_id,
        ap.codigo_elaboracion,
        ap.estado AS estado_accion,
        ta.nombre AS tipo_accion,
        af.estado AS estado_recepcion,
        af.firmado_en,
        ap.archivo_aprueba_autoridad,
        ap.archivo_recibido
      FROM core.accion_firma af
      JOIN core.accion_personal ap ON ap.id = af.accion_id
      JOIN core.tipo_accion ta ON ta.id = ap.tipo_accion_id
      WHERE af.rol_firma = 'RECIBIDO' AND af.servidor_id = $1
      ORDER BY
        CASE WHEN af.estado = 'PENDIENTE' THEN 0 ELSE 1 END,
        ap.fecha_elaboracion DESC;
      `,
      [servidor_id],
    );
    return res.json(rows);
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error obteniendo recepciones", error: err.message });
  }
});

// POST /api/firmas/acciones/:accionId/firmar-recepcion
// Paso final del flujo: el servidor público al que pertenece la acción
// (ya APROBADA por UATH + Gerente) firma como recibida, con su propio
// certificado P12. No modifica accion_personal.estado — la acción ya
// quedó aprobada en el paso anterior; esto solo registra la recepción.
router.post(
  "/acciones/:accionId/firmar-recepcion",
  requireAuth,
  async (req, res) => {
    const { accionId } = req.params;
    const { password } = req.body;

    if (!password)
      return res
        .status(400)
        .json({ message: "Contraseña del certificado requerida" });

    const { servidorId: servidor_id, viaFirmante } =
      await resolverServidorPropio(req);
    if (!servidor_id)
      return res.status(404).json({
        message: "No tienes una recepción pendiente para esta acción",
      });

    try {
      // 1. Firma pendiente de este servidor para esta acción
      const firmaR = await pool.query(
        `
        SELECT af.id, ap.estado AS estado_accion, ap.archivo_aprueba_autoridad,
               ap.codigo_elaboracion
        FROM core.accion_firma af
        JOIN core.accion_personal ap ON ap.id = af.accion_id
        WHERE af.accion_id = $1
          AND af.rol_firma = 'RECIBIDO'
          AND af.servidor_id = $2
          AND af.estado = 'PENDIENTE'
        LIMIT 1
        `,
        [accionId, servidor_id],
      );

      if (!firmaR.rows.length)
        return res.status(404).json({
          message: "No tienes una recepción pendiente para esta acción",
        });

      const firma = firmaR.rows[0];

      // 2. La acción debe estar aprobada por UATH y Gerente antes de que
      // el servidor pueda firmar como recibido.
      if (firma.estado_accion !== "APROBADO") {
        return res.status(409).json({
          message:
            "Esta acción todavía no ha sido aprobada por todos los responsables",
        });
      }
      if (!firma.archivo_aprueba_autoridad) {
        return res.status(409).json({
          message: "La acción no tiene el documento aprobado disponible",
        });
      }

      // 3. Certificado propio. Si esta persona inició sesión como
      // FIRMANTE (tiene ambas identidades, ej. un Jefe de Área a quien
      // también se le hace una Acción de Personal), usa el mismo
      // certificado que ya gestiona como firmante — no tiene sentido
      // pedirle que suba un segundo P12 para la misma persona.
      const p12R = viaFirmante
        ? await pool.query(
            `SELECT p12_path, p12_activo, nombre AS nombres FROM core.firmante WHERE id = $1`,
            [req.user.firmante_id],
          )
        : await pool.query(
            `SELECT p12_path, p12_activo, nombres FROM core.servidor WHERE id = $1`,
            [servidor_id],
          );
      if (!p12R.rows[0]?.p12_path || !p12R.rows[0]?.p12_activo)
        return res.status(400).json({
          message:
            "No tienes un certificado digital registrado. Ve a Mi Certificado",
        });

      const p12FullPath = path.resolve(
        process.env.UPLOADS_DIR || "uploads",
        p12R.rows[0].p12_path.replace("/uploads/", ""),
      );
      const nombreServidor = p12R.rows[0].nombres;

      // 4. PDF base: el último aprobado por la autoridad (Gerente)
      const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
      const filePath = path.resolve(
        uploadsBase,
        firma.archivo_aprueba_autoridad.replace("/uploads/", ""),
      );
      const pdfBuffer = fs.readFileSync(filePath);

      // 5. Firmar con el P12 del servidor
      let signedPdf;
      try {
        signedPdf = await firmarPdfAccionConP12({
          pdfInputBuffer: pdfBuffer,
          p12Path: p12FullPath,
          p12Password: password,
          firmante: nombreServidor,
          cargo: "Servidor Público",
          posicion: "recibido",
        });
      } catch (err) {
        if (
          err.message?.includes("password") ||
          err.message?.includes("passphrase")
        )
          return res
            .status(400)
            .json({ message: "Contraseña del certificado incorrecta" });
        throw err;
      }

      // 6. Guardar PDF firmado
      const codigo = firma.codigo_elaboracion || accionId;
      const dir = path.resolve(
        uploadsBase,
        "acciones",
        codigo,
        "firmas",
        "recibido",
      );
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filename = `firmado_${Date.now()}.pdf`;
      const destPath = path.join(dir, filename);
      fs.writeFileSync(destPath, signedPdf);
      const archivoPath = `/uploads/${path.relative(uploadsBase, destPath).replaceAll("\\", "/")}`;

      // 7. Actualizar BD — guardar archivo y marcar la recepción como
      // FIRMADO. accion_personal.estado NO se toca: la acción ya estaba
      // APROBADO y sigue así.
      await pool.query(
        `UPDATE core.accion_personal SET archivo_recibido = $1 WHERE id = $2`,
        [archivoPath, accionId],
      );

      await pool.query(
        `
        UPDATE core.accion_firma
        SET estado = 'FIRMADO', firmado_en = NOW()
        WHERE id = $1
        `,
        [firma.id],
      );

      return res.json({
        message: "Recepción firmada digitalmente",
        archivo: archivoPath,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error firmando recepción", error: err.message });
    }
  },
);

export default router;
