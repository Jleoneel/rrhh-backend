import { Router } from "express";
import { pool } from "../../../../db.js";
import {
  requireAuth,
  requireFirmante,
} from "../../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../../shared/utils/sseManager.js";
import {
  firmarPdfConP12,
  marcarAprobadoEnPdf,
} from "../../../../shared/utils/firmarPdf.service.js";
import { generarPdfVacacionBuffer } from "../vacaciones/vacacionesPdf.controller.js";
import path from "path";
import fs from "fs";
import { enviarCorreo } from "../../../../shared/utils/email.service.js";

const router = Router();

//HELPER: obtener p12 del firmante
const obtenerP12 = async (firmante_id) => {
  const { rows } = await pool.query(
    `SELECT p12_path, p12_activo FROM core.firmante WHERE id = $1`,
    [firmante_id],
  );
  if (!rows.length || !rows[0].p12_path || !rows[0].p12_activo) return null;
  return rows[0].p12_path;
};

// HELPER: guardar PDF firmado
const guardarPdfFirmado = (signedPdf, solicitudId, tipo) => {
  const dir = path.resolve(
    process.env.UPLOADS_DIR || "uploads",
    "vacaciones",
    `solicitud_${solicitudId}`,
    tipo,
  );
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `firmado_${Date.now()}.pdf`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, signedPdf);
  const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
  return `/uploads/${path.relative(uploadsBase, filePath).replaceAll("\\", "/")}`;
};

//CONFIRMAR FIRMA JEFE
router.post(
  "/:id/confirmar-firma-jefe",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { id } = req.params;
    const { firmante_id } = req.user;
    const { password } = req.body;

    if (!password)
      return res
        .status(400)
        .json({ message: "Contraseña del token requerida" });

    try {
      const { rows } = await pool.query(
        `
      SELECT vs.*, f.nombre AS jefe_nombre, c.nombre AS jefe_cargo
      FROM core.vacacion_solicitud vs
      JOIN core.firmante f ON f.id = vs.jefe_firmante_id
      JOIN core.cargo c ON c.id = f.cargo_id
      WHERE vs.id = $1
    `,
        [id],
      );

      if (!rows.length)
        return res.status(404).json({ message: "Solicitud no encontrada" });
      const solicitud = rows[0];

      if (solicitud.jefe_firmante_id !== firmante_id)
        return res.status(403).json({ message: "No autorizado" });
      if (solicitud.estado !== "PENDIENTE_JEFE")
        return res
          .status(409)
          .json({ message: "Esta solicitud no está pendiente de jefe" });

      // Verificar que tiene p12
      const p12Path = await obtenerP12(firmante_id);
      if (!p12Path)
        return res.status(400).json({
          message:
            "No tienes un certificado digital registrado. Ve a Configuración > Mi Certificado para subir tu .p12",
        });

      const p12FullPath = path.resolve(
        process.env.UPLOADS_DIR || "uploads",
        p12Path.replace("/uploads/", ""),
      );

      // Generar PDF base
      const pdfBuffer = await generarPdfVacacionBuffer(id);

      // Firmar con p12
      let signedPdf;
      try {
        signedPdf = await firmarPdfConP12({
          pdfInputBuffer: pdfBuffer,
          p12Path: p12FullPath,
          p12Password: password,
          firmante: solicitud.jefe_nombre,
          cargo: solicitud.jefe_cargo,
          posicion: "jefe",
        });
      } catch (err) {
        if (
          err.message?.includes("password") ||
          err.message?.includes("passphrase")
        ) {
          return res
            .status(400)
            .json({ message: "Contraseña del token incorrecta" });
        }
        throw err;
      }

      // Guardar PDF firmado
      const archivoPath = guardarPdfFirmado(signedPdf, id, "jefe");

      // Actualizar BD
      const nuevoEstado = solicitud.gerente_id
        ? "PENDIENTE_GERENTE"
        : "PENDIENTE_UATH";
      let uath_id = null;
      if (!solicitud.gerente_id) {
        const uathR = await pool.query(`
        SELECT f.id FROM core.firmante f JOIN core.cargo c ON c.id = f.cargo_id
        WHERE c.nombre = 'RESPONSABLE DE LA UATH' AND f.activo = true LIMIT 1
      `);
        uath_id = uathR.rows[0]?.id || null;
      }

      const horas = parseFloat(solicitud.dias_solicitados) * 8;
      await pool.query(
        `UPDATE core.saldo_permiso SET horas_usadas = horas_usadas + $1, updated_at = NOW() WHERE servidor_id = $2`,
        [horas, solicitud.servidor_id],
      );
      await pool.query(
        `INSERT INTO core.permiso_movimiento (servidor_id, horas, tipo, descripcion, creado_por) VALUES ($1, $2, 'DESCUENTO', 'Vacaciones aprobadas por jefe inmediato', $3)`,
        [solicitud.servidor_id, horas, firmante_id],
      );

      await pool.query(
        `
      UPDATE core.vacacion_solicitud
      SET estado = $1, fecha_respuesta_jefe = NOW(), uath_id = COALESCE($2, uath_id), archivo_jefe = $3
      WHERE id = $4
    `,
        [nuevoEstado, uath_id, archivoPath, id],
      );

      const notificarId = solicitud.gerente_id || uath_id;
      if (notificarId) {
        await pool.query(
          `INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo) VALUES ($1, $2, 'NUEVA_SOLICITUD')`,
          [id, notificarId],
        );
        notifyCargoId(`permiso-firmante-${notificarId}`, {
          tipo: "NUEVA_SOLICITUD",
          vacacion_id: id,
          mensaje: "Solicitud de vacaciones pendiente de tu aprobación",
          es_vacacion: true,
        });
      }

      // ← Correo al siguiente firmante
      const notificarR = await pool.query(
        `
  SELECT f.nombre, f.email FROM core.firmante f WHERE f.id = $1
`,
        [notificarId],
      );

      const svR = await pool.query(
        `
  SELECT sv.nombres FROM core.servidor sv WHERE sv.id = $1
`,
        [solicitud.servidor_id],
      );

      if (notificarR.rows[0]?.email) {
        await enviarCorreo(notificarR.rows[0].email, "nuevaSolicitudVacacion", {
          jefe_nombre: notificarR.rows[0].nombre,
          servidor_nombre: svR.rows[0]?.nombres || "",
          fecha_inicio: solicitud.fecha_inicio,
          fecha_fin: solicitud.fecha_fin,
          dias: solicitud.dias_solicitados,
          tipo: solicitud.tipo,
        });
      }

      return res.json({
        message: "Solicitud firmada y enviada al siguiente paso",
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error firmando solicitud", error: err.message });
    }
  },
);

//CONFIRMAR FIRMA SUPERIOR
router.post(
  "/:id/confirmar-firma-superior",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { id } = req.params;
    const { firmante_id } = req.user;
    const { password } = req.body;

    if (!password)
      return res
        .status(400)
        .json({ message: "Contraseña del token requerida" });

    try {
      const { rows } = await pool.query(
        `
      SELECT vs.*, f.nombre AS gerente_nombre, c.nombre AS gerente_cargo
      FROM core.vacacion_solicitud vs
      JOIN core.firmante f ON f.id = vs.gerente_id
      JOIN core.cargo c ON c.id = f.cargo_id
      WHERE vs.id = $1
    `,
        [id],
      );

      if (!rows.length)
        return res.status(404).json({ message: "Solicitud no encontrada" });
      const solicitud = rows[0];

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

      const p12Path = await obtenerP12(firmante_id);
      if (!p12Path)
        return res.status(400).json({
          message:
            "No tienes un certificado digital registrado. Ve a Configuración > Mi Certificado para subir tu .p12",
        });

      const p12FullPath = path.resolve(
        process.env.UPLOADS_DIR || "uploads",
        p12Path.replace("/uploads/", ""),
      );

      // Tomar el PDF ya firmado por el jefe y agregarle la firma del superior
      let pdfBuffer;
      if (solicitud.archivo_jefe) {
        const jefeFilePath = path.resolve(
          process.env.UPLOADS_DIR || "uploads",
          solicitud.archivo_jefe.replace("/uploads/", ""),
        );
        pdfBuffer = fs.readFileSync(jefeFilePath);
      } else {
        pdfBuffer = await generarPdfVacacionBuffer(id);
      }

      let signedPdf;
      try {
        signedPdf = await firmarPdfConP12({
          pdfInputBuffer: pdfBuffer,
          p12Path: p12FullPath,
          p12Password: password,
          firmante: solicitud.gerente_nombre,
          cargo: solicitud.gerente_cargo,
          posicion: "superior",
        });
      } catch (err) {
        if (
          err.message?.includes("password") ||
          err.message?.includes("passphrase")
        ) {
          return res
            .status(400)
            .json({ message: "Contraseña del token incorrecta" });
        }
        throw err;
      }

      const archivoPath = guardarPdfFirmado(signedPdf, id, "superior");

      const uathR = await pool.query(`
      SELECT f.id FROM core.firmante f JOIN core.cargo c ON c.id = f.cargo_id
      WHERE c.nombre = 'RESPONSABLE DE LA UATH' AND f.activo = true LIMIT 1
    `);
      const uath_id = uathR.rows[0]?.id || null;

      await pool.query(
        `
      UPDATE core.vacacion_solicitud
      SET estado = 'PENDIENTE_UATH', fecha_respuesta_gerente = NOW(), uath_id = $1, archivo_superior = $2
      WHERE id = $3
    `,
        [uath_id, archivoPath, id],
      );

      if (uath_id) {
        await pool.query(
          `INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo) VALUES ($1, $2, 'NUEVA_SOLICITUD')`,
          [id, uath_id],
        );
        notifyCargoId(`permiso-firmante-${uath_id}`, {
          tipo: "NUEVA_SOLICITUD",
          vacacion_id: id,
          mensaje: "Solicitud de vacaciones pendiente de certificación UATH",
          es_vacacion: true,
        });
      }
      // ← Correo a UATH
      const uathEmailR = await pool.query(
        `
  SELECT f.nombre, f.email FROM core.firmante f WHERE f.id = $1
`,
        [uath_id],
      );

      const svR2 = await pool.query(
        `
  SELECT sv.nombres FROM core.servidor sv WHERE sv.id = $1
`,
        [solicitud.servidor_id],
      );

      if (uathEmailR.rows[0]?.email) {
        await enviarCorreo(uathEmailR.rows[0].email, "nuevaSolicitudVacacion", {
          jefe_nombre: uathEmailR.rows[0].nombre,
          servidor_nombre: svR2.rows[0]?.nombres || "",
          fecha_inicio: solicitud.fecha_inicio,
          fecha_fin: solicitud.fecha_fin,
          dias: solicitud.dias_solicitados,
          tipo: solicitud.tipo,
        });
      }

      return res.json({ message: "Solicitud firmada y enviada a UATH" });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error firmando solicitud", error: err.message });
    }
  },
);

// CONFIRMAR FIRMA UATH
router.post(
  "/:id/confirmar-firma-uath",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { id } = req.params;
    const { firmante_id } = req.user;
    const { password } = req.body;

    if (!password)
      return res
        .status(400)
        .json({ message: "Contraseña del token requerida" });

    try {
      const { rows } = await pool.query(
        `
      SELECT vs.*, f.nombre AS uath_nombre, c.nombre AS uath_cargo
      FROM core.vacacion_solicitud vs
      JOIN core.firmante f ON f.id = vs.uath_id
      JOIN core.cargo c ON c.id = f.cargo_id
      WHERE vs.id = $1
    `,
        [id],
      );

      if (!rows.length)
        return res.status(404).json({ message: "Solicitud no encontrada" });
      const solicitud = rows[0];

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

      const p12Path = await obtenerP12(firmante_id);
      if (!p12Path)
        return res.status(400).json({
          message:
            "No tienes un certificado digital registrado. Ve a Configuración > Mi Certificado para subir tu .p12",
        });

      const p12FullPath = path.resolve(
        process.env.UPLOADS_DIR || "uploads",
        p12Path.replace("/uploads/", ""),
      );

      // ← PRIMERO actualizar estado a APROBADO
      await pool.query(
        `
      UPDATE core.vacacion_solicitud
      SET estado = 'APROBADO', fecha_respuesta_uath = NOW(), uath_id = $1
      WHERE id = $2
    `,
        [firmante_id, id],
      );

      // ← Tomar PDF del paso anterior como base
      let pdfBuffer;
      if (solicitud.archivo_superior) {
        const filePath = path.resolve(
          process.env.UPLOADS_DIR || "uploads",
          solicitud.archivo_superior.replace("/uploads/", ""),
        );
        pdfBuffer = fs.readFileSync(filePath);
      } else if (solicitud.archivo_jefe) {
        const filePath = path.resolve(
          process.env.UPLOADS_DIR || "uploads",
          solicitud.archivo_jefe.replace("/uploads/", ""),
        );
        pdfBuffer = fs.readFileSync(filePath);
      } else {
        pdfBuffer = await generarPdfVacacionBuffer(id);
      }

      // ← Marcar checkbox AUTORIZADO antes de firmar
      pdfBuffer = await marcarAprobadoEnPdf(pdfBuffer);

      let signedPdf;
      try {
        signedPdf = await firmarPdfConP12({
          pdfInputBuffer: pdfBuffer,
          p12Path: p12FullPath,
          p12Password: password,
          firmante: solicitud.uath_nombre,
          cargo: solicitud.uath_cargo,
          posicion: "uath",
        });
      } catch (err) {
        if (
          err.message?.includes("password") ||
          err.message?.includes("passphrase")
        ) {
          return res
            .status(400)
            .json({ message: "Contraseña del token incorrecta" });
        }
        throw err;
      }

      const archivoPath = guardarPdfFirmado(signedPdf, id, "uath");

      await pool.query(
        `
      UPDATE core.vacacion_solicitud SET archivo_uath = $1 WHERE id = $2
    `,
        [archivoPath, id],
      );

      const firmanteVinculadoR = await pool.query(
        `
      SELECT f.id AS firmante_id FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE sv.id = $1 LIMIT 1
    `,
        [solicitud.servidor_id],
      );

      const firmanteVinculado = firmanteVinculadoR.rows[0]?.firmante_id || null;

      if (firmanteVinculado) {
        await pool.query(
          `INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo) VALUES ($1, $2, 'APROBADO')`,
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
          `INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, servidor_id, tipo) VALUES ($1, $2, 'APROBADO')`,
          [id, solicitud.servidor_id],
        );
        notifyCargoId(`permiso-servidor-${solicitud.servidor_id}`, {
          tipo: "APROBADO",
          vacacion_id: id,
          mensaje: "Tus vacaciones fueron aprobadas y certificadas",
          es_vacacion: true,
        });
      }

      // ← Correo al servidor notificando aprobación
      const svEmailR = await pool.query(
        `
  SELECT sv.nombres, sv.email FROM core.servidor sv WHERE sv.id = $1
`,
        [solicitud.servidor_id],
      );

      if (svEmailR.rows[0]?.email) {
        await enviarCorreo(svEmailR.rows[0].email, "solicitudAprobada", {
          servidor_nombre: svEmailR.rows[0].nombres,
          tipo: solicitud.tipo,
          fecha_inicio: solicitud.fecha_inicio,
          fecha_fin: solicitud.fecha_fin,
          dias: solicitud.dias_solicitados,
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

// DESCARGAR ARCHIVO
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

    if (!Object.prototype.hasOwnProperty.call(colMap, tipo))
      return res
        .status(400)
        .json({ message: "Tipo inválido. Usa: jefe, superior, uath, base" });

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
