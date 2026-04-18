import { Router } from "express";
import { pool } from "../../../../db.js";
import { requireAuth, requireFirmante } from "../../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../../shared/utils/sseManager.js";
import { upload } from "./vacaciones.multer.js";
import path from "path";
import fs from "fs";

const router = Router();

// ─── SUBIR FIRMA JEFE ─────────────────────────────────────────
router.post("/:id/subir-firma-jefe", requireAuth, requireFirmante, upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const { firmante_id } = req.user;

  if (!req.file) return res.status(400).json({ message: "Archivo PDF requerido" });

  const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
  const archivoPath = `/uploads/${path.relative(uploadsBase, req.file.path).replaceAll("\\", "/")}`;

  try {
    const { rows } = await pool.query(`SELECT * FROM core.vacacion_solicitud WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ message: "Solicitud no encontrada" });
    const solicitud = rows[0];

    if (solicitud.jefe_firmante_id !== firmante_id) return res.status(403).json({ message: "No autorizado" });
    if (solicitud.estado !== "PENDIENTE_JEFE") return res.status(409).json({ message: "Esta solicitud no está pendiente de jefe" });

    await pool.query(`UPDATE core.vacacion_solicitud SET archivo_jefe = $1 WHERE id = $2`, [archivoPath, id]);
    return res.json({ message: "PDF guardado correctamente", archivo: archivoPath });
  } catch (err) {
    return res.status(500).json({ message: "Error subiendo firma", error: err.message });
  }
});

// ─── CONFIRMAR FIRMA JEFE ─────────────────────────────────────
router.post("/:id/confirmar-firma-jefe", requireAuth, requireFirmante, async (req, res) => {
  const { id } = req.params;
  const { firmante_id } = req.user;

  try {
    const { rows } = await pool.query(`SELECT * FROM core.vacacion_solicitud WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ message: "Solicitud no encontrada" });
    const solicitud = rows[0];

    if (solicitud.jefe_firmante_id !== firmante_id) return res.status(403).json({ message: "No autorizado" });
    if (solicitud.estado !== "PENDIENTE_JEFE") return res.status(409).json({ message: "Esta solicitud no está pendiente de jefe" });
    if (!solicitud.archivo_jefe) return res.status(400).json({ message: "Debes subir el PDF firmado antes de confirmar" });

    const nuevoEstado = solicitud.gerente_id ? "PENDIENTE_GERENTE" : "PENDIENTE_UATH";
    let uath_id = null;
    if (!solicitud.gerente_id) {
      const uathR = await pool.query(`
        SELECT f.id FROM core.firmante f JOIN core.cargo c ON c.id = f.cargo_id
        WHERE c.nombre = 'RESPONSABLE DE LA UATH' AND f.activo = true LIMIT 1
      `);
      uath_id = uathR.rows[0]?.id || null;
    }

    const horas = parseFloat(solicitud.dias_solicitados) * 8;
    await pool.query(`UPDATE core.saldo_permiso SET horas_usadas = horas_usadas + $1, updated_at = NOW() WHERE servidor_id = $2`, [horas, solicitud.servidor_id]);
    await pool.query(`INSERT INTO core.permiso_movimiento (servidor_id, horas, tipo, descripcion, creado_por) VALUES ($1, $2, 'DESCUENTO', 'Vacaciones aprobadas por jefe inmediato', $3)`, [solicitud.servidor_id, horas, firmante_id]);

    await pool.query(`
      UPDATE core.vacacion_solicitud
      SET estado = $1, fecha_respuesta_jefe = NOW(), uath_id = COALESCE($2, uath_id)
      WHERE id = $3
    `, [nuevoEstado, uath_id, id]);

    const notificarId = solicitud.gerente_id || uath_id;
    if (notificarId) {
      await pool.query(`INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo) VALUES ($1, $2, 'NUEVA_SOLICITUD')`, [id, notificarId]);
      notifyCargoId(`permiso-firmante-${notificarId}`, { tipo: "NUEVA_SOLICITUD", vacacion_id: id, mensaje: "Solicitud de vacaciones pendiente de tu aprobación", es_vacacion: true });
    }

    return res.json({ message: "Solicitud enviada al siguiente paso" });
  } catch (err) {
    return res.status(500).json({ message: "Error confirmando firma", error: err.message });
  }
});

// ─── SUBIR FIRMA SUPERIOR ─────────────────────────────────────
router.post("/:id/subir-firma-superior", requireAuth, requireFirmante, upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const { firmante_id } = req.user;

  if (!req.file) return res.status(400).json({ message: "Archivo PDF requerido" });

  const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
  const archivoPath = `/uploads/${path.relative(uploadsBase, req.file.path).replaceAll("\\", "/")}`;

  try {
    const { rows } = await pool.query(`SELECT * FROM core.vacacion_solicitud WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ message: "Solicitud no encontrada" });
    const solicitud = rows[0];

    if (solicitud.jefe_firmante_id === firmante_id) return res.status(403).json({ message: "No puedes aprobar tu propia solicitud en dos pasos del flujo" });
    if (solicitud.gerente_id !== firmante_id) return res.status(403).json({ message: "No autorizado" });
    if (solicitud.estado !== "PENDIENTE_GERENTE") return res.status(409).json({ message: "Esta solicitud no está pendiente de jefe superior" });

    await pool.query(`UPDATE core.vacacion_solicitud SET archivo_superior = $1 WHERE id = $2`, [archivoPath, id]);
    return res.json({ message: "PDF guardado correctamente", archivo: archivoPath });
  } catch (err) {
    return res.status(500).json({ message: "Error subiendo firma", error: err.message });
  }
});

// ─── CONFIRMAR FIRMA SUPERIOR ─────────────────────────────────
router.post("/:id/confirmar-firma-superior", requireAuth, requireFirmante, async (req, res) => {
  const { id } = req.params;
  const { firmante_id } = req.user;

  try {
    const { rows } = await pool.query(`SELECT * FROM core.vacacion_solicitud WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ message: "Solicitud no encontrada" });
    const solicitud = rows[0];

    if (solicitud.jefe_firmante_id === firmante_id) return res.status(403).json({ message: "No puedes aprobar tu propia solicitud en dos pasos del flujo" });
    if (solicitud.gerente_id !== firmante_id) return res.status(403).json({ message: "No autorizado" });
    if (solicitud.estado !== "PENDIENTE_GERENTE") return res.status(409).json({ message: "Esta solicitud no está pendiente de jefe superior" });
    if (!solicitud.archivo_superior) return res.status(400).json({ message: "Debes subir el PDF firmado antes de confirmar" });

    const uathR = await pool.query(`
      SELECT f.id FROM core.firmante f JOIN core.cargo c ON c.id = f.cargo_id
      WHERE c.nombre = 'RESPONSABLE DE LA UATH' AND f.activo = true LIMIT 1
    `);
    const uath_id = uathR.rows[0]?.id || null;

    await pool.query(`
      UPDATE core.vacacion_solicitud
      SET estado = 'PENDIENTE_UATH', fecha_respuesta_gerente = NOW(), uath_id = $1
      WHERE id = $2
    `, [uath_id, id]);

    if (uath_id) {
      await pool.query(`INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo) VALUES ($1, $2, 'NUEVA_SOLICITUD')`, [id, uath_id]);
      notifyCargoId(`permiso-firmante-${uath_id}`, { tipo: "NUEVA_SOLICITUD", vacacion_id: id, mensaje: "Solicitud de vacaciones pendiente de certificación UATH", es_vacacion: true });
    }

    return res.json({ message: "Solicitud enviada a UATH" });
  } catch (err) {
    return res.status(500).json({ message: "Error confirmando firma", error: err.message });
  }
});

// ─── SUBIR FIRMA UATH ─────────────────────────────────────────
router.post("/:id/subir-firma-uath", requireAuth, requireFirmante, upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const { firmante_id } = req.user;

  if (!req.file) return res.status(400).json({ message: "Archivo PDF requerido" });

  const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
  const archivoPath = `/uploads/${path.relative(uploadsBase, req.file.path).replaceAll("\\", "/")}`;

  try {
    const { rows } = await pool.query(`SELECT * FROM core.vacacion_solicitud WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ message: "Solicitud no encontrada" });
    const solicitud = rows[0];

    if (solicitud.jefe_firmante_id === firmante_id || solicitud.gerente_id === firmante_id)
      return res.status(403).json({ message: "No puedes certificar una solicitud que ya aprobaste en pasos anteriores" });
    if (solicitud.uath_id !== firmante_id) return res.status(403).json({ message: "No autorizado" });
    if (solicitud.estado !== "PENDIENTE_UATH") return res.status(409).json({ message: "Esta solicitud no está pendiente de UATH" });

    await pool.query(`UPDATE core.vacacion_solicitud SET archivo_uath = $1 WHERE id = $2`, [archivoPath, id]);
    return res.json({ message: "PDF guardado correctamente", archivo: archivoPath });
  } catch (err) {
    return res.status(500).json({ message: "Error subiendo firma UATH", error: err.message });
  }
});

// ─── CONFIRMAR FIRMA UATH ─────────────────────────────────────
router.post("/:id/confirmar-firma-uath", requireAuth, requireFirmante, async (req, res) => {
  const { id } = req.params;
  const { firmante_id } = req.user;

  try {
    const { rows } = await pool.query(`SELECT * FROM core.vacacion_solicitud WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ message: "Solicitud no encontrada" });
    const solicitud = rows[0];

    if (solicitud.jefe_firmante_id === firmante_id || solicitud.gerente_id === firmante_id)
      return res.status(403).json({ message: "No puedes certificar una solicitud que ya aprobaste en pasos anteriores" });
    if (solicitud.uath_id !== firmante_id) return res.status(403).json({ message: "No autorizado" });
    if (solicitud.estado !== "PENDIENTE_UATH") return res.status(409).json({ message: "Esta solicitud no está pendiente de UATH" });
    if (!solicitud.archivo_uath) return res.status(400).json({ message: "Debes subir el PDF firmado antes de confirmar" });

    await pool.query(`
      UPDATE core.vacacion_solicitud
      SET estado = 'APROBADO', fecha_respuesta_uath = NOW(), uath_id = $1
      WHERE id = $2
    `, [firmante_id, id]);

    const firmanteVinculadoR = await pool.query(`
      SELECT f.id AS firmante_id FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE sv.id = $1 LIMIT 1
    `, [solicitud.servidor_id]);

    const firmanteVinculado = firmanteVinculadoR.rows[0]?.firmante_id || null;

    if (firmanteVinculado) {
      await pool.query(`INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo) VALUES ($1, $2, 'APROBADO')`, [id, firmanteVinculado]);
      notifyCargoId(`permiso-firmante-${firmanteVinculado}`, { tipo: "APROBADO", vacacion_id: id, mensaje: "Tus vacaciones fueron aprobadas y certificadas", es_vacacion: true });
    } else {
      await pool.query(`INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, servidor_id, tipo) VALUES ($1, $2, 'APROBADO')`, [id, solicitud.servidor_id]);
      notifyCargoId(`permiso-servidor-${solicitud.servidor_id}`, { tipo: "APROBADO", vacacion_id: id, mensaje: "Tus vacaciones fueron aprobadas y certificadas", es_vacacion: true });
    }

    return res.json({ message: "Vacaciones certificadas correctamente" });
  } catch (err) {
    return res.status(500).json({ message: "Error confirmando certificación", error: err.message });
  }
});

// ─── DESCARGAR ARCHIVO ────────────────────────────────────────
router.get("/:id/descargar-vacacion/:tipo", requireAuth, requireFirmante, async (req, res) => {
  const { id, tipo } = req.params;
  const colMap = { jefe: "archivo_jefe", superior: "archivo_superior", uath: "archivo_uath", base: null };

  if (!Object.prototype.hasOwnProperty.call(colMap, tipo))
    return res.status(400).json({ message: "Tipo inválido. Usa: jefe, superior, uath, base" });

  try {
    if (tipo === "base") return res.redirect(`/api/permisos/${id}/pdf-vacacion`);

    const col = colMap[tipo];
    const { rows } = await pool.query(`SELECT ${col} AS archivo FROM core.vacacion_solicitud WHERE id = $1`, [id]);

    if (!rows.length || !rows[0].archivo) return res.status(404).json({ message: "Archivo no encontrado" });

    const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
    const filePath = path.join(uploadsBase, rows[0].archivo.replace("/uploads/", ""));

    if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Archivo no encontrado en el servidor" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=vacacion_${tipo}_${id}.pdf`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    return res.status(500).json({ message: "Error descargando archivo", error: err.message });
  }
});

export default router;