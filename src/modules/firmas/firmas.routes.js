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
import { notifyCargoId } from "../../shared/utils/sseManager.js";

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
    const { firmante_id } = req.user;
    cb(null, `${firmante_id}.p12`);
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
  requireFirmante,
  upload.single("file"),
  async (req, res) => {
    const { firmante_id } = req.user;
    if (!req.file)
      return res.status(400).json({ message: "Archivo .p12 requerido" });

    const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
    const rel = path.relative(uploadsBase, req.file.path).replaceAll("\\", "/");
    const p12Path = `/uploads/${rel}`;

    try {
      await pool.query(
        `UPDATE core.firmante SET p12_path = $1, p12_activo = true WHERE id = $2`,
        [p12Path, firmante_id],
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
router.get(
  "/mi-certificado",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { firmante_id } = req.user;
    try {
      const { rows } = await pool.query(
        `SELECT p12_path, p12_activo FROM core.firmante WHERE id = $1`,
        [firmante_id],
      );
      return res.json({
        tiene_certificado: !!rows[0]?.p12_path,
        p12_activo: rows[0]?.p12_activo || false,
      });
    } catch (err) {
      return res.status(500).json({ message: "Error", error: err.message });
    }
  },
);

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
        AND af.cargo_id = $2
        AND af.estado = 'PENDIENTE'
      ORDER BY af.orden ASC
      LIMIT 1
    `,
        [accionId, cargo_id],
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

      // 9. Recalcular estado de la acción
      await pool.query(
        `
      UPDATE core.accion_personal ap
      SET estado = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM core.accion_firma af
          WHERE af.accion_id = ap.id AND af.estado = 'PENDIENTE'
        ) THEN 'APROBADO'
        ELSE 'EN_FIRMA'
      END
      WHERE ap.id = $1
    `,
        [accionId],
      );

      // 10. Notificar al siguiente firmante
      const siguienteR = await pool.query(
        `SELECT af.cargo_id, af.orden, af.rol_firma
          FROM core.accion_firma af
        WHERE af.accion_id = $1 AND af.estado = 'PENDIENTE'
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

export default router;
