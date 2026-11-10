import { Router } from "express";
import { pool } from "../../../db.js";
import {
  requireAuth,
  requireFirmante,
} from "../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../shared/utils/sseManager.js";
import {
  firmarPdfConP12,
  marcarAprobadoEnPdf,
} from "../../../shared/utils/firmarPdf.service.js";
import { generarPdfVacacionBuffer } from "../vacaciones/vacacionesPdf.controller.js";
import path from "path";
import fs from "fs";
import { enviarCorreo } from "../../../shared/utils/email.service.js";
import {
  cargoPuedeActuarComo,
  CARGO_IDS,
} from "../../../shared/constants/cargos.js";

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

// HELPER: guardar PDF firmado (también usado por
// vac-solicitudes-servidor.routes.js para la firma del solicitante)
export const guardarPdfFirmado = (signedPdf, solicitudId, tipo) => {
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

    // Todo el flujo (lectura con bloqueo de fila, firma del PDF, descuento
    // de saldo y cambio de estado) corre en UNA transacción: antes cada
    // paso era un pool.query suelto, así que un doble clic o una red lenta
    // podía firmar y descontar saldo dos veces para una sola aprobación
    // real. El SELECT ... FOR UPDATE bloquea la fila desde el principio,
    // así que una segunda petición concurrente para la misma solicitud
    // queda esperando hasta el COMMIT/ROLLBACK de la primera y, al
    // reanudar, ve el estado ya actualizado (el WHERE estado=... del
    // UPDATE final es una segunda red de seguridad, no la única).
    const client = await pool.connect();
    let solicitud, notificarId;
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `
      SELECT vs.*, f.nombre AS jefe_nombre, c.nombre AS jefe_cargo
      FROM core.vacacion_solicitud vs
      JOIN core.firmante f ON f.id = vs.jefe_firmante_id
      JOIN core.cargo c ON c.id = f.cargo_id
      WHERE vs.id = $1
      FOR UPDATE OF vs
    `,
        [id],
      );

      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Solicitud no encontrada" });
      }
      solicitud = rows[0];

      if (solicitud.jefe_firmante_id !== firmante_id) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "No autorizado" });
      }
      if (solicitud.estado !== "PENDIENTE_JEFE") {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ message: "Esta solicitud no está pendiente de jefe" });
      }

      // Verificar que tiene p12
      const p12Path = await obtenerP12(firmante_id);
      if (!p12Path) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message:
            "No tienes un certificado digital registrado. Ve a Configuración > Mi Certificado para subir tu .p12",
        });
      }

      const p12FullPath = path.resolve(
        process.env.UPLOADS_DIR || "uploads",
        p12Path.replace("/uploads/", ""),
      );

      // Generar PDF base — si el solicitante ya firmó al crear la
      // solicitud (ver vac-solicitudes-servidor.routes.js), partir de ESE
      // PDF para no perder su firma; si no, generar uno nuevo.
      let pdfBuffer;
      if (solicitud.archivo_solicitante) {
        const filePath = path.resolve(
          process.env.UPLOADS_DIR || "uploads",
          solicitud.archivo_solicitante.replace("/uploads/", ""),
        );
        pdfBuffer = fs.readFileSync(filePath);
      } else {
        pdfBuffer = await generarPdfVacacionBuffer(id);
      }

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
        await client.query("ROLLBACK");
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
        const uathR = await client.query(`
        SELECT f.id FROM core.firmante f JOIN core.cargo c ON c.id = f.cargo_id
        WHERE c.nombre = 'RESPONSABLE DE LA UATH' AND f.activo = true LIMIT 1
      `);
        uath_id = uathR.rows[0]?.id || null;
      }

      const horas = parseFloat(solicitud.dias_solicitados) * 8;
      await client.query(
        `UPDATE core.saldo_permiso SET horas_usadas = horas_usadas + $1, updated_at = NOW() WHERE servidor_id = $2`,
        [horas, solicitud.servidor_id],
      );
      await client.query(
        `INSERT INTO core.permiso_movimiento (servidor_id, horas, tipo, descripcion, creado_por) VALUES ($1, $2, 'DESCUENTO', 'Vacaciones aprobadas por jefe inmediato', $3)`,
        [solicitud.servidor_id, horas, firmante_id],
      );

      const updateR = await client.query(
        `
      UPDATE core.vacacion_solicitud
      SET estado = $1, fecha_respuesta_jefe = NOW(), uath_id = COALESCE($2, uath_id), archivo_jefe = $3
      WHERE id = $4 AND estado = 'PENDIENTE_JEFE'
    `,
        [nuevoEstado, uath_id, archivoPath, id],
      );
      if (updateR.rowCount === 0) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ message: "Esta solicitud ya fue procesada" });
      }

      notificarId = solicitud.gerente_id || uath_id;
      if (notificarId) {
        await client.query(
          `INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo) VALUES ($1, $2, 'NUEVA_SOLICITUD')`,
          [id, notificarId],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error firmando solicitud:", err);
      return res.status(500).json({ message: "Error firmando solicitud" });
    } finally {
      client.release();
    }

    // Efectos secundarios NO críticos (push SSE + correo): la aprobación
    // YA quedó guardada (COMMIT exitoso arriba); si esto falla, se loguea
    // pero no se reporta como error al firmante ni se reintenta el
    // descuento de saldo.
    if (notificarId) {
      try {
        notifyCargoId(`permiso-firmante-${notificarId}`, {
          tipo: "NUEVA_SOLICITUD",
          vacacion_id: id,
          mensaje: "Solicitud de vacaciones pendiente de tu aprobación",
          es_vacacion: true,
        });

        const notificarR = await pool.query(
          `SELECT f.nombre, f.email FROM core.firmante f WHERE f.id = $1`,
          [notificarId],
        );
        const svR = await pool.query(
          `
    SELECT sv.nombres, sv.numero_identificacion, u.nombre AS unidad_organica
    FROM core.servidor sv
    LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
    LEFT JOIN core.puesto p ON p.id = ap.puesto_id
    LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
    WHERE sv.id = $1
  `,
          [solicitud.servidor_id],
        );

        if (notificarR.rows[0]?.email) {
          await enviarCorreo(
            notificarR.rows[0].email,
            "nuevaSolicitudVacacion",
            {
              jefe_nombre: notificarR.rows[0].nombre,
              servidor_nombre: svR.rows[0]?.nombres || "",
              cedula: svR.rows[0]?.numero_identificacion || "",
              unidad: svR.rows[0]?.unidad_organica || "",
              fecha_inicio: solicitud.fecha_inicio,
              fecha_fin: solicitud.fecha_fin,
              dias: solicitud.dias_solicitados,
              tipo: solicitud.tipo,
            },
          );
        }
      } catch (err) {
        console.error(
          "Error notificando al siguiente firmante (no crítico, la firma ya se guardó):",
          err,
        );
      }
    }

    return res.json({
      message: "Solicitud firmada y enviada al siguiente paso",
    });
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

    // Mismo motivo que confirmar-firma-jefe: todo en una transacción con
    // FOR UPDATE, para que un doble clic no firme/notifique dos veces.
    const client = await pool.connect();
    let solicitud, uath_id;
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `
      SELECT vs.*, f.nombre AS gerente_nombre, c.nombre AS gerente_cargo
      FROM core.vacacion_solicitud vs
      JOIN core.firmante f ON f.id = vs.gerente_id
      JOIN core.cargo c ON c.id = f.cargo_id
      WHERE vs.id = $1
      FOR UPDATE OF vs
    `,
        [id],
      );

      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Solicitud no encontrada" });
      }
      solicitud = rows[0];

      if (solicitud.jefe_firmante_id === firmante_id) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          message:
            "No puedes aprobar tu propia solicitud en dos pasos del flujo",
        });
      }
      if (solicitud.gerente_id !== firmante_id) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "No autorizado" });
      }
      if (solicitud.estado !== "PENDIENTE_GERENTE") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "Esta solicitud no está pendiente de jefe superior",
        });
      }

      const p12Path = await obtenerP12(firmante_id);
      if (!p12Path) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message:
            "No tienes un certificado digital registrado. Ve a Configuración > Mi Certificado para subir tu .p12",
        });
      }

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
        await client.query("ROLLBACK");
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

      const uathR = await client.query(`
      SELECT f.id FROM core.firmante f JOIN core.cargo c ON c.id = f.cargo_id
      WHERE c.nombre = 'RESPONSABLE DE LA UATH' AND f.activo = true LIMIT 1
    `);
      uath_id = uathR.rows[0]?.id || null;

      const updateR = await client.query(
        `
      UPDATE core.vacacion_solicitud
      SET estado = 'PENDIENTE_UATH', fecha_respuesta_gerente = NOW(), uath_id = $1, archivo_superior = $2
      WHERE id = $3 AND estado = 'PENDIENTE_GERENTE'
    `,
        [uath_id, archivoPath, id],
      );
      if (updateR.rowCount === 0) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ message: "Esta solicitud ya fue procesada" });
      }

      if (uath_id) {
        await client.query(
          `INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo) VALUES ($1, $2, 'NUEVA_SOLICITUD')`,
          [id, uath_id],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error firmando solicitud:", err);
      return res.status(500).json({ message: "Error firmando solicitud" });
    } finally {
      client.release();
    }

    // Efectos secundarios NO críticos — ver nota en confirmar-firma-jefe.
    if (uath_id) {
      try {
        notifyCargoId(`permiso-firmante-${uath_id}`, {
          tipo: "NUEVA_SOLICITUD",
          vacacion_id: id,
          mensaje: "Solicitud de vacaciones pendiente de certificación UATH",
          es_vacacion: true,
        });

        const uathEmailR = await pool.query(
          `SELECT f.nombre, f.email FROM core.firmante f WHERE f.id = $1`,
          [uath_id],
        );
        const svR2 = await pool.query(
          `
    SELECT sv.nombres, sv.numero_identificacion, u.nombre AS unidad_organica
    FROM core.servidor sv
    LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
    LEFT JOIN core.puesto p ON p.id = ap.puesto_id
    LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
    WHERE sv.id = $1
  `,
          [solicitud.servidor_id],
        );

        if (uathEmailR.rows[0]?.email) {
          await enviarCorreo(
            uathEmailR.rows[0].email,
            "nuevaSolicitudVacacion",
            {
              jefe_nombre: uathEmailR.rows[0].nombre,
              servidor_nombre: svR2.rows[0]?.nombres || "",
              cedula: svR2.rows[0]?.numero_identificacion || "",
              unidad: svR2.rows[0]?.unidad_organica || "",
              fecha_inicio: solicitud.fecha_inicio,
              fecha_fin: solicitud.fecha_fin,
              dias: solicitud.dias_solicitados,
              tipo: solicitud.tipo,
            },
          );
        }
      } catch (err) {
        console.error(
          "Error notificando a UATH (no crítico, la firma ya se guardó):",
          err,
        );
      }
    }

    return res.json({ message: "Solicitud firmada y enviada a UATH" });
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
      return res.status(400).json({ message: "Contraseña del token requerida" });

    // Mismo motivo que los dos endpoints anteriores: transacción + FOR
    // UPDATE para que un doble clic no certifique/apruebe dos veces.
    const client = await pool.connect();
    let solicitud, firmanteVinculado;
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(`
        SELECT vs.*, f.nombre AS uath_nombre, c.nombre AS uath_cargo
        FROM core.vacacion_solicitud vs
        JOIN core.firmante f ON f.id = vs.uath_id
        JOIN core.cargo c ON c.id = f.cargo_id
        WHERE vs.id = $1
        FOR UPDATE OF vs
      `, [id]);

      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Solicitud no encontrada" });
      }
      solicitud = rows[0];

      if (solicitud.jefe_firmante_id === firmante_id || solicitud.gerente_id === firmante_id) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "No puedes certificar una solicitud que ya aprobaste en pasos anteriores" });
      }
      if (solicitud.uath_id !== firmante_id) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "No autorizado" });
      }
      if (solicitud.estado !== "PENDIENTE_UATH") {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Esta solicitud no está pendiente de UATH" });
      }

      const p12Path = await obtenerP12(firmante_id);
      if (!p12Path) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "No tienes un certificado digital registrado. Ve a Configuración > Mi Certificado para subir tu .p12" });
      }

      const p12FullPath = path.resolve(
        process.env.UPLOADS_DIR || "uploads",
        p12Path.replace("/uploads/", ""),
      );

      // ← Tomar PDF del paso anterior como base
      let pdfBuffer;
      if (solicitud.archivo_superior) {
        const filePath = path.resolve(process.env.UPLOADS_DIR || "uploads", solicitud.archivo_superior.replace("/uploads/", ""));
        pdfBuffer = fs.readFileSync(filePath);
      } else if (solicitud.archivo_jefe) {
        const filePath = path.resolve(process.env.UPLOADS_DIR || "uploads", solicitud.archivo_jefe.replace("/uploads/", ""));
        pdfBuffer = fs.readFileSync(filePath);
      } else {
        pdfBuffer = await generarPdfVacacionBuffer(id);
      }

      // ← Marcar checkbox AUTORIZADO antes de firmar
      pdfBuffer = await marcarAprobadoEnPdf(pdfBuffer);

      // ← PRIMERO firmar — si falla la contraseña, el estado NO cambia
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
        await client.query("ROLLBACK");
        if (err.message?.includes("password") || err.message?.includes("passphrase"))
          return res.status(400).json({ message: "Contraseña del token incorrecta" });
        throw err;
      }

      const archivoPath = guardarPdfFirmado(signedPdf, id, "uath");

      // Un solo UPDATE (antes eran dos sueltos) y condicionado al estado
      // vigente, para que una segunda petición concurrente no vuelva a
      // "aprobar" ni a sobrescribir el archivo.
      const updateR = await client.query(`
        UPDATE core.vacacion_solicitud
        SET estado = 'APROBADO', fecha_respuesta_uath = NOW(), uath_id = $1, archivo_uath = $2
        WHERE id = $3 AND estado = 'PENDIENTE_UATH'
      `, [firmante_id, archivoPath, id]);
      if (updateR.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Esta solicitud ya fue procesada" });
      }

      const firmanteVinculadoR = await client.query(`
        SELECT f.id AS firmante_id FROM core.firmante f
        JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
        WHERE sv.id = $1 LIMIT 1
      `, [solicitud.servidor_id]);
      firmanteVinculado = firmanteVinculadoR.rows[0]?.firmante_id || null;

      if (firmanteVinculado) {
        await client.query(
          `INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo) VALUES ($1, $2, 'APROBADO')`,
          [id, firmanteVinculado],
        );
      } else {
        await client.query(
          `INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, servidor_id, tipo) VALUES ($1, $2, 'APROBADO')`,
          [id, solicitud.servidor_id],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error confirmando certificación:", err);
      return res.status(500).json({ message: "Error confirmando certificación" });
    } finally {
      client.release();
    }

    // Efectos secundarios NO críticos — ver nota en confirmar-firma-jefe.
    try {
      if (firmanteVinculado) {
        notifyCargoId(`permiso-firmante-${firmanteVinculado}`, {
          tipo: "APROBADO", vacacion_id: id,
          mensaje: "Tus vacaciones fueron aprobadas y certificadas", es_vacacion: true,
        });
      } else {
        notifyCargoId(`permiso-servidor-${solicitud.servidor_id}`, {
          tipo: "APROBADO", vacacion_id: id,
          mensaje: "Tus vacaciones fueron aprobadas y certificadas", es_vacacion: true,
        });
      }

      const svEmailR = await pool.query(`
        SELECT sv.nombres, sv.email FROM core.servidor sv WHERE sv.id = $1
      `, [solicitud.servidor_id]);

      if (svEmailR.rows[0]?.email) {
        await enviarCorreo(svEmailR.rows[0].email, "solicitudAprobada", {
          servidor_nombre: svEmailR.rows[0].nombres,
          tipo: solicitud.tipo,
          fecha_inicio: solicitud.fecha_inicio,
          fecha_fin: solicitud.fecha_fin,
          dias: solicitud.dias_solicitados,
          aprobado_por: solicitud.uath_nombre || "",
        });
      }

      // Norma institucional: toda vacación aprobada se notifica, además
      // de al servidor, a un departamento fijo configurado por UATH —
      // ver core.configuracion_notificaciones.
      const configR = await pool.query(
        `SELECT email_notificacion_vacaciones FROM core.configuracion_notificaciones WHERE id = 1`,
      );
      const correoDepartamento = configR.rows[0]?.email_notificacion_vacaciones;
      if (correoDepartamento) {
        await enviarCorreo(correoDepartamento, "vacacionAprobadaTerceros", {
          servidor_nombre: svEmailR.rows[0]?.nombres || "",
          tipo: solicitud.tipo,
          fecha_inicio: solicitud.fecha_inicio,
          fecha_fin: solicitud.fecha_fin,
          dias: solicitud.dias_solicitados,
          aprobado_por: solicitud.uath_nombre || "",
        });
      }
    } catch (err) {
      console.error(
        "Error enviando notificaciones de certificación (no crítico, ya se guardó):",
        err,
      );
    }

    return res.json({ message: "Vacaciones certificadas correctamente" });
  },
);

// DESCARGAR ARCHIVO — firmante (cualquiera en la cadena) o el servidor
// dueño de la solicitud.
router.get(
  "/:id/descargar-vacacion/:tipo",
  requireAuth,
  async (req, res) => {
    const { id, tipo } = req.params;
    const colMap = {
      solicitante: "archivo_solicitante",
      jefe: "archivo_jefe",
      superior: "archivo_superior",
      uath: "archivo_uath",
      base: null,
    };

    if (!Object.prototype.hasOwnProperty.call(colMap, tipo))
      return res
        .status(400)
        .json({
          message:
            "Tipo inválido. Usa: solicitante, jefe, superior, uath, base",
        });

    try {
      // Antes cualquier FIRMANTE pasaba sin más chequeo — un jefe de
      // Mantenimiento podía descargar vacaciones de empleados de
      // Dirección Médica con solo cambiar el id. Ahora se exige que
      // participe en la cadena de esta solicitud (jefe/gerente/UATH) o
      // sea admin, igual que ya se exige para el servidor dueño.
      if (req.user.tipo_usuario === "SERVIDOR") {
        const propia = await pool.query(
          `SELECT 1 FROM core.vacacion_solicitud WHERE id = $1 AND servidor_id = $2`,
          [id, req.user.servidor_id],
        );
        if (!propia.rows.length) {
          return res.status(403).json({ message: "No autorizado" });
        }
      } else if (req.user.tipo_usuario === "FIRMANTE") {
        // UATH (y equivalentes) y admin ven cualquier vacación — mismo
        // criterio que en vacacionesPdf.controller.js y en
        // cronogramaVacaciones.routes.js (tieneAccesoTotal).
        const accesoTotal =
          req.user.es_admin === true ||
          cargoPuedeActuarComo(req.user.cargo_id, CARGO_IDS.ASISTENTE_UATH) ||
          req.user.cargo_id === CARGO_IDS.RESPONSABLE_UATH;
        if (!accesoTotal) {
          const participa = await pool.query(
            `SELECT 1 FROM core.vacacion_solicitud
             WHERE id = $1 AND (jefe_firmante_id = $2 OR gerente_id = $2 OR uath_id = $2)`,
            [id, req.user.firmante_id],
          );
          if (!participa.rows.length) {
            return res.status(403).json({ message: "No autorizado" });
          }
        }
      } else {
        return res.status(403).json({ message: "No autorizado" });
      }

      if (tipo === "base") {
        const token = req.query.token
          ? `?token=${encodeURIComponent(req.query.token)}`
          : "";
        return res.redirect(`/api/permisos/${id}/pdf-vacacion${token}`);
      }

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
      console.error("Error descargando archivo:", err);
      return res
        .status(500)
        .json({ message: "Error descargando archivo" });
    }
  },
);

export default router;
