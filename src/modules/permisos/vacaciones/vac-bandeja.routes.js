import { Router } from "express";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { pool } from "../../../db.js";
import { requireAuth, requireFirmante } from "../../../shared/middleware/auth.middleware.js";
import { notifyCargoId } from "../../../shared/utils/sseManager.js";
import { enviarCorreo, formatearFecha } from "../../../shared/utils/email.service.js";
import { reingresarSaldoSiYaDescontado } from "../../../shared/utils/saldoVacaciones.js";
import { generarPdfVacacionBuffer } from "./vacacionesPdf.controller.js";
import { CARGO_IDS, cargoPuedeActuarComo } from "../../../shared/constants/cargos.js";

const router = Router();

// UATH (y equivalentes) y admin ven el reporte de TODO el hospital — un
// jefe de área o gerente normal solo debe ver (y ahora descargar en bloque)
// las solicitudes de su propia unidad. Mismo criterio que ya usa
// cronogramaVacaciones.routes.js (tieneAccesoTotal): antes este reporte no
// filtraba por nadie ("para todos" literal en el comentario del Sidebar),
// así que cualquier firmante podía ver y bajar las vacaciones de cualquier
// servidor del hospital con solo entrar a esta pantalla.
function tieneAccesoTotal(req) {
  return (
    req.user?.es_admin === true ||
    cargoPuedeActuarComo(req.user?.cargo_id, CARGO_IDS.ASISTENTE_UATH) ||
    req.user?.cargo_id === CARGO_IDS.RESPONSABLE_UATH
  );
}

// El mismo WHERE del reporte (filtros de fecha de solicitud/estado/unidad/
// búsqueda + el scoping por unidad de quien consulta), extraído para que lo
// use también el ZIP masivo de PDFs sin duplicar esta lógica — ambos deben
// filtrar exactamente igual, para que "descargar todos los PDF" baje los
// mismos que se ven en pantalla (ni más, ni menos).
function construirFiltrosReporteVacaciones(query, req) {
  const { fecha, fecha_desde, fecha_hasta, estado, unidad_organica_id, search, todos } = query;
  const verDia = todos === "false" || todos === "0";

  let where = "WHERE 1=1";
  const values = [];
  let i = 1;

  if (!tieneAccesoTotal(req)) {
    where += ` AND (u.jefe_id = $${i} OR u.jefe_superior_id = $${i})`;
    values.push(req.user.firmante_id);
    i++;
  }
  if (verDia) {
    const hoy = new Date().toISOString().split("T")[0];
    const desde = fecha_desde || fecha || hoy;
    const hasta = fecha_hasta || fecha_desde || fecha || hoy;
    where += ` AND vs.fecha_solicitud BETWEEN $${i} AND $${i + 1}`;
    values.push(desde, hasta);
    i += 2;
  }
  if (estado && estado !== "TODOS") {
    where += ` AND vs.estado = $${i}`;
    values.push(estado);
    i++;
  }
  if (unidad_organica_id) {
    where += ` AND u.id = $${i}`;
    values.push(unidad_organica_id);
    i++;
  }
  if (search) {
    where += ` AND (sv.nombres ILIKE $${i} OR sv.numero_identificacion ILIKE $${i})`;
    values.push(`%${search}%`);
    i++;
  }
  return { where, values };
}

// Misma regla que el botón "PDF" de cada fila en el reporte: qué archivo ya
// firmado corresponde a la etapa actual (ver handleDescargarPdf en
// ReporteVacaciones.jsx) — NEGADO no tiene PDF que ofrecer, así que esas
// solicitudes se excluyen del ZIP, igual que no tienen botón en pantalla.
const COLUMNA_POR_ESTADO = {
  PENDIENTE_JEFE: "archivo_solicitante",
  PENDIENTE_GERENTE: "archivo_jefe",
  PENDIENTE_UATH: "archivo_superior",
  APROBADO: "archivo_uath",
};

// GET /api/permisos/bandeja-vacaciones
//
// Incluye tanto lo pendiente de este firmante como su HISTORIAL: toda
// solicitud en la que ya participó (ya respondió en su paso), sin
// importar qué pasó después en pasos posteriores — igual que
// bandeja.routes.js (permisos por horas), que no filtra por estado, solo
// por jefe_firmante_id.
router.get("/bandeja-vacaciones", requireAuth, requireFirmante, async (req, res) => {
  const { firmante_id } = req.user;
  try {
    const { rows } = await pool.query(`
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado, vs.created_at,
        vs.archivo_solicitante, vs.archivo_jefe, vs.archivo_superior, vs.archivo_uath,
        vs.observacion_jefe, vs.observacion_gerente, vs.observacion_uath,
        (
          (vs.jefe_firmante_id = $1 AND vs.estado = 'PENDIENTE_JEFE') OR
          (vs.gerente_id = $1 AND vs.estado = 'PENDIENTE_GERENTE') OR
          (vs.uath_id = $1 AND vs.estado = 'PENDIENTE_UATH')
        ) AS es_mi_turno,
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
        (vs.jefe_firmante_id = $1 AND (vs.estado = 'PENDIENTE_JEFE' OR vs.fecha_respuesta_jefe IS NOT NULL)) OR
        (vs.gerente_id = $1 AND (vs.estado = 'PENDIENTE_GERENTE' OR vs.fecha_respuesta_gerente IS NOT NULL)) OR
        (vs.uath_id = $1 AND (vs.estado = 'PENDIENTE_UATH' OR vs.fecha_respuesta_uath IS NOT NULL))
      )
      ORDER BY
        CASE WHEN vs.estado IN ('PENDIENTE_JEFE', 'PENDIENTE_GERENTE', 'PENDIENTE_UATH') THEN 1 ELSE 2 END,
        vs.created_at DESC
    `, [firmante_id]);
    return res.json(rows);
  } catch (err) {
    console.error("Error obteniendo bandeja:", err);
    return res.status(500).json({ message: "Error obteniendo bandeja" });
  }
});

// GET /api/permisos/reporte-vacaciones
router.get("/reporte-vacaciones", requireAuth, requireFirmante, async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  // A diferencia del reporte de permisos, aquí "todos" es el modo por
  // defecto: una solicitud de vacaciones no es algo que se revise "por
  // día" como un permiso puntual, así que solo se filtra por fecha de
  // solicitud (no por el período de vacación, que ya se ve en la columna
  // "Período") si el usuario explícitamente pide ver un rango de días en
  // que se hicieron las solicitudes. `fecha` se mantiene por compatibilidad
  // (filtro de un solo día); si viene `fecha_desde`/`fecha_hasta` se usa
  // como rango, y si solo viene una punta se usa como día único.
  // (ver construirFiltrosReporteVacaciones)
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const { where, values } = construirFiltrosReporteVacaciones(req.query, req);
    let i = values.length + 1;

    const countResult = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      ${where}
    `,
      values,
    );
    const total = parseInt(countResult.rows[0].total);

    const resumenResult = await pool.query(
      `
      SELECT
        CASE WHEN vs.estado LIKE 'PENDIENTE%' THEN 'PENDIENTE' ELSE vs.estado END AS grupo,
        COUNT(*) AS n
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      ${where}
      GROUP BY grupo
    `,
      values,
    );
    const resumen = { PENDIENTE: 0, APROBADO: 0, NEGADO: 0 };
    for (const r of resumenResult.rows) {
      resumen[r.grupo] = parseInt(r.n);
    }

    const { rows } = await pool.query(`
      SELECT
        vs.id, vs.tipo, vs.dias_solicitados, vs.estado, vs.archivo_uath,
        TO_CHAR(vs.fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
        TO_CHAR(vs.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
        TO_CHAR(vs.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
        sv.nombres AS servidor_nombre,
        sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica,
        fj.nombre AS jefe_nombre,
        vs.archivo_uath,
        COALESCE(vs.observacion_jefe, vs.observacion_gerente, vs.observacion_uath) AS observacion
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      LEFT JOIN core.firmante fj ON fj.id = vs.jefe_firmante_id
      ${where}
      ORDER BY vs.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, [...values, parseInt(limit), offset]);

    return res.json({
      data: rows,
      total,
      resumen,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.max(1, Math.ceil(total / parseInt(limit))),
    });
  } catch (err) {
    console.error("Error obteniendo reporte:", err);
    return res.status(500).json({ message: "Error obteniendo reporte" });
  }
});

// GET /api/permisos/reporte-vacaciones/zip
//
// Descarga de una sola vez, en un .zip, el PDF de cada solicitud que
// cumple los MISMOS filtros que el reporte en pantalla (sin paginar, igual
// que "Exportar Excel") — evita que el navegador tenga que disparar un
// request por fila. Por cada solicitud se arma exactamente el mismo
// archivo que bajaría su botón individual: el último ya firmado según la
// etapa (ver tipoPdfParaEstado en ReporteVacaciones.jsx), o el PDF simple
// generado al vuelo si esa etapa todavía no tiene archivo (ej. el
// servidor no firmó su propia solicitud). NEGADO no tiene PDF que ofrecer
// — se excluye, igual que no tiene botón en pantalla.
router.get("/reporte-vacaciones/zip", requireAuth, requireFirmante, async (req, res) => {
  try {
    const { where, values } = construirFiltrosReporteVacaciones(req.query, req);

    const { rows } = await pool.query(
      `
      SELECT
        vs.id, vs.estado,
        vs.archivo_solicitante, vs.archivo_jefe, vs.archivo_superior, vs.archivo_uath,
        sv.nombres AS servidor_nombre,
        sv.numero_identificacion AS cedula
      FROM core.vacacion_solicitud vs
      JOIN core.servidor sv ON sv.id = vs.servidor_id
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      ${where}
      ORDER BY vs.created_at DESC
      `,
      values,
    );

    const conPdf = rows.filter((r) => COLUMNA_POR_ESTADO[r.estado]);
    if (!conPdf.length) {
      return res.status(404).json({
        message: "No hay solicitudes con PDF para los filtros aplicados",
      });
    }

    const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
    const limpiarNombre = (texto = "") =>
      texto.toString().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vacaciones_pdfs_${new Date().toISOString().split("T")[0]}.zip"`,
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error("Error armando el zip de vacaciones:", err);
      // Los headers ya se enviaron (es un stream) — no se puede mandar un
      // JSON de error a esta altura, solo cortar la conexión.
      res.destroy();
    });
    archive.pipe(res);

    for (const sol of conPdf) {
      const col = COLUMNA_POR_ESTADO[sol.estado];
      let buffer = null;

      const archivo = sol[col];
      if (archivo) {
        const filePath = path.join(uploadsBase, archivo.replace("/uploads/", ""));
        if (fs.existsSync(filePath)) {
          buffer = fs.readFileSync(filePath);
        }
      }

      if (!buffer) {
        try {
          buffer = await generarPdfVacacionBuffer(sol.id);
        } catch (err) {
          console.error(`No se pudo generar el PDF de la solicitud ${sol.id}:`, err);
          continue; // una solicitud con error no debe tumbar todo el zip
        }
      }

      const nombreArchivo = `${String(sol.id).padStart(4, "0")}_${limpiarNombre(sol.cedula)}_${limpiarNombre(sol.servidor_nombre)}.pdf`;
      archive.append(buffer, { name: nombreArchivo });
    }

    await archive.finalize();
  } catch (err) {
    console.error("Error generando el zip de vacaciones:", err);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Error generando el zip de PDFs" });
    }
    res.destroy();
  }
});

// PUT /api/permisos/:id/responder-vacacion
router.put("/:id/responder-vacacion", requireAuth, requireFirmante, async (req, res) => {
  const { id } = req.params;
  const { aprobado, observacion } = req.body;
  const { firmante_id, nombre: firmante_nombre } = req.user;

  if (aprobado) {
    return res.status(400).json({
      message:
        "La aprobación de vacaciones se realiza firmando la solicitud con tu certificado digital.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const solicitudR = await client.query(`SELECT * FROM core.vacacion_solicitud WHERE id = $1`, [id]);

    if (!solicitudR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Solicitud no encontrada" });
    }

    const solicitud = solicitudR.rows[0];
    const esJefe = solicitud.jefe_firmante_id === firmante_id && solicitud.estado === "PENDIENTE_JEFE";
    const esGerente = solicitud.gerente_id === firmante_id && solicitud.estado === "PENDIENTE_GERENTE";
    const esUath = solicitud.uath_id === firmante_id && solicitud.estado === "PENDIENTE_UATH";

    if (!esJefe && !esGerente && !esUath) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "No autorizado para responder esta solicitud" });
    }

    if (esGerente && solicitud.jefe_firmante_id === firmante_id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "No puedes aprobar en dos pasos del mismo flujo" });
    }

    await client.query(`
      UPDATE core.vacacion_solicitud
      SET estado = 'NEGADO',
          observacion_jefe = CASE WHEN $2 THEN $3 ELSE observacion_jefe END,
          observacion_gerente = CASE WHEN $4 THEN $3 ELSE observacion_gerente END,
          observacion_uath = CASE WHEN $5 THEN $3 ELSE observacion_uath END,
          fecha_respuesta_jefe = CASE WHEN $2 THEN NOW() ELSE fecha_respuesta_jefe END,
          fecha_respuesta_gerente = CASE WHEN $4 THEN NOW() ELSE fecha_respuesta_gerente END,
          fecha_respuesta_uath = CASE WHEN $5 THEN NOW() ELSE fecha_respuesta_uath END
      WHERE id = $1
    `, [id, esJefe, observacion || null, esGerente, esUath]);

    // Si el jefe inmediato ya había aprobado (negado en la etapa de
    // gerente o UATH), ya se le había descontado el saldo a este
    // servidor — sin esto, la vacación queda NEGADA pero las horas
    // siguen "gastadas" para siempre, lo que hasta ahora obligaba a
    // corregirlo a mano por base de datos. Reingresa las mismas horas
    // dentro de esta misma transacción (no se toca si negó el propio
    // jefe: ahí nunca se había descontado nada).
    const etapa = esGerente ? "del jefe superior" : esUath ? "de UATH" : "";
    await reingresarSaldoSiYaDescontado(client, solicitud, {
      creadoPor: firmante_id,
      descripcion: `Vacación #${id} negada en la etapa ${etapa} tras la aprobación del jefe inmediato — se reingresan las horas ya descontadas`,
    });

    await client.query("COMMIT");

    const firmanteVinculadoR = await pool.query(`
      SELECT f.id AS firmante_id
      FROM core.firmante f
      JOIN core.servidor sv ON sv.numero_identificacion = f.numero_identificacion
      WHERE sv.id = $1 LIMIT 1
    `, [solicitud.servidor_id]);

    const firmanteVinculado = firmanteVinculadoR.rows[0]?.firmante_id || null;

    // Notificación persistente (igual que el camino APROBADO en
    // vac-firmas.routes.js) — antes solo se emitía el push SSE, que se
    // pierde si el servidor no está conectado en ese instante: quedaba sin
    // registro alguno de que su solicitud fue negada.
    if (firmanteVinculado) {
      await pool.query(
        `INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, firmante_id, tipo) VALUES ($1, $2, 'NEGADO')`,
        [id, firmanteVinculado],
      );
      notifyCargoId(`permiso-firmante-${firmanteVinculado}`, {
        tipo: "NEGADO",
        vacacion_id: id,
        mensaje: "Tu solicitud de vacaciones fue negada",
        es_vacacion: true,
      });
    } else {
      await pool.query(
        `INSERT INTO core.notificacion_permiso (vacacion_solicitud_id, servidor_id, tipo) VALUES ($1, $2, 'NEGADO')`,
        [id, solicitud.servidor_id],
      );
      notifyCargoId(`permiso-servidor-${solicitud.servidor_id}`, {
        tipo: "NEGADO",
        vacacion_id: id,
        mensaje: "Tu solicitud de vacaciones fue negada",
        es_vacacion: true,
      });
    }

    // ← Correo al servidor (antes este camino no enviaba ninguno)
    const svEmailR = await pool.query(
      `
    SELECT sv.nombres, sv.email, sv.numero_identificacion, u.nombre AS unidad_organica
    FROM core.servidor sv
    LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
    LEFT JOIN core.puesto p ON p.id = ap.puesto_id
    LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
    WHERE sv.id = $1
  `,
      [solicitud.servidor_id],
    );

    if (svEmailR.rows[0]?.email) {
      await enviarCorreo(svEmailR.rows[0].email, "solicitudNegada", {
        servidor_nombre: svEmailR.rows[0].nombres,
        tipo: solicitud.tipo === "VACACION_PROGRAMADA" ? "Vacación Programada" : "Permiso con Cargo",
        unidad: svEmailR.rows[0]?.unidad_organica || "",
        periodo: `${formatearFecha(solicitud.fecha_inicio)} → ${formatearFecha(solicitud.fecha_fin)}`,
        observacion: observacion || "",
        negado_por: firmante_nombre || "",
      });
    }

    return res.json({ message: "Solicitud procesada correctamente" });
  } catch (err) {
    console.error("Error procesando solicitud de vacaciones:", err);
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error procesando solicitud" });
  } finally {
    client.release();
  }
});

export default router;
