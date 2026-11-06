import { Router } from "express";
import { pool } from "../../db.js";
import {
  requireAuth,
  requireFirmante,
} from "../../shared/middleware/auth.middleware.js";
import {
  CARGO_IDS,
  cargoPuedeActuarComo,
} from "../../shared/constants/cargos.js";

const router = Router();

const TOPE_DIAS_ANUAL = 30;

// UATH (y equivalentes: auxiliar, analista TH) y el admin ven/gestionan el
// cronograma de TODO el personal, no solo el de su propia unidad — mismo
// criterio que el resto del sistema (requireCargo), pero sin bloquear la
// ruta para jefes de área normales, que sí deben entrar aquí.
function tieneAccesoTotal(req) {
  return (
    req.user?.es_admin === true ||
    cargoPuedeActuarComo(req.user?.cargo_id, CARGO_IDS.ASISTENTE_UATH)
  );
}

function diasEntre(fechaDesde, fechaHasta) {
  const ms = new Date(fechaHasta) - new Date(fechaDesde);
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
}

// new Date("YYYY-MM-DD").getFullYear() parsea la fecha como UTC medianoche
// y la vuelve a leer en la hora LOCAL del servidor — en America/Guayaquil
// (UTC-5) eso corre un 1 de enero a las 19:00 del 31 de diciembre anterior,
// así que un bloque que empieza el 1 de enero quedaba guardado con el año
// equivocado (el anterior). Se extrae el año directamente del string, sin
// pasar por ninguna conversión de huso horario.
function anioDeFecha(fechaStr) {
  return parseInt(fechaStr.slice(0, 4), 10);
}

// Un jefe (inmediato o superior) solo puede gestionar el cronograma de
// servidores cuya unidad orgánica ACTIVA es la suya — mismo criterio de
// pertenencia que ya usa el resto del sistema (jefe_id / jefe_superior_id).
async function puedeGestionarServidor(req, servidorId) {
  if (tieneAccesoTotal(req)) return true;
  const { rows } = await pool.query(
    `SELECT 1
     FROM core.asignacion_puesto ap
     JOIN core.puesto p ON p.id = ap.puesto_id
     JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
     WHERE ap.servidor_id = $1 AND ap.estado = 'ACTIVA'
       AND (u.jefe_id = $2 OR u.jefe_superior_id = $2)
     LIMIT 1`,
    [servidorId, req.user.firmante_id],
  );
  return rows.length > 0;
}

// Arma el mismo WHERE (scoping por jefe + filtros de unidad/búsqueda) con
// los placeholders numerados desde `desde` — reutilizado tanto por el
// listado principal como por el COUNT de la paginación, que no comparten
// el mismo set de parámetros (el COUNT no necesita el año).
function construirFiltros(req, desde) {
  const { unidad_organica_id, search } = req.query;
  const accesoTotal = tieneAccesoTotal(req);
  const values = [];
  let i = desde;
  let sql = "";
  if (!accesoTotal) {
    sql += ` AND (u.jefe_id = $${i} OR u.jefe_superior_id = $${i})`;
    values.push(req.user.firmante_id);
    i++;
  }
  if (unidad_organica_id) {
    sql += ` AND u.id = $${i}`;
    values.push(unidad_organica_id);
    i++;
  }
  if (search) {
    sql += ` AND (sv.nombres ILIKE $${i} OR sv.numero_identificacion ILIKE $${i})`;
    values.push(`%${search}%`);
    i++;
  }
  return { sql, values, siguiente: i };
}

// GET /api/cronograma-vacaciones?anio=2026&page=1&limit=10
// Personal visible para quien consulta (su propia unidad, o todos si es
// UATH/admin) con el total de días ya planificados ese año.
router.get("/", requireAuth, requireFirmante, async (req, res) => {
  const anio = parseInt(req.query.anio) || new Date().getFullYear();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.max(1, parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;

  try {
    const countFiltros = construirFiltros(req, 1);
    const countR = await pool.query(
      `
      SELECT COUNT(DISTINCT sv.id) AS total
      FROM core.asignacion_puesto ap
      JOIN core.puesto p ON p.id = ap.puesto_id
      JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      JOIN core.servidor sv ON sv.id = ap.servidor_id
      WHERE ap.estado = 'ACTIVA' AND sv.activo = true
      ${countFiltros.sql}
      `,
      countFiltros.values,
    );
    const total = parseInt(countR.rows[0].total);

    // Conteo sobre TODO lo que coincide con los filtros (no solo la página
    // actual) para las tarjetas de resumen — mismo criterio que ya usa
    // reporte.routes.js para no mostrar un resumen que cambie según la
    // página en la que esté parado quien consulta.
    const resumenFiltros = construirFiltros(req, 2);
    const resumenR = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE dias_totales > 0)::int AS con_vacaciones,
        COUNT(*) FILTER (WHERE dias_totales >= $${resumenFiltros.siguiente})::int AS en_tope
      FROM (
        SELECT sv.id, COALESCE(SUM(b.dias), 0) AS dias_totales
        FROM core.asignacion_puesto ap
        JOIN core.puesto p ON p.id = ap.puesto_id
        JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
        JOIN core.servidor sv ON sv.id = ap.servidor_id
        LEFT JOIN core.cronograma_vacaciones_bloque b
          ON b.servidor_id = sv.id AND b.anio = $1
        WHERE ap.estado = 'ACTIVA' AND sv.activo = true
        ${resumenFiltros.sql}
        GROUP BY sv.id
      ) sub
      `,
      [anio, ...resumenFiltros.values, TOPE_DIAS_ANUAL],
    );
    const conVacaciones = resumenR.rows[0].con_vacaciones;
    const enTope = resumenR.rows[0].en_tope;

    const listaFiltros = construirFiltros(req, 2);
    const { rows } = await pool.query(
      `
      SELECT
        sv.id AS servidor_id, sv.nombres, sv.numero_identificacion AS cedula,
        d.nombre AS denominacion, u.nombre AS unidad_organica,
        COALESCE(SUM(b.dias), 0)::int AS dias_planificados
      FROM core.asignacion_puesto ap
      JOIN core.puesto p ON p.id = ap.puesto_id
      JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      JOIN core.servidor sv ON sv.id = ap.servidor_id
      LEFT JOIN core.denominacion_puesto d ON d.id = p.denominacion_puesto_id
      LEFT JOIN core.cronograma_vacaciones_bloque b
        ON b.servidor_id = sv.id AND b.anio = $1
      WHERE ap.estado = 'ACTIVA' AND sv.activo = true
      ${listaFiltros.sql}
      GROUP BY sv.id, sv.nombres, sv.numero_identificacion, d.nombre, u.nombre
      ORDER BY sv.nombres ASC
      LIMIT $${listaFiltros.siguiente} OFFSET $${listaFiltros.siguiente + 1}
      `,
      [anio, ...listaFiltros.values, limit, offset],
    );

    return res.json({
      anio,
      tope_dias_anual: TOPE_DIAS_ANUAL,
      data: rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      resumen: { con_vacaciones: conVacaciones, en_tope: enTope },
    });
  } catch (err) {
    console.error("Error obteniendo cronograma de vacaciones:", err);
    return res
      .status(500)
      .json({ message: "Error obteniendo cronograma de vacaciones" });
  }
});

// GET /api/cronograma-vacaciones/exportar?anio=2026
// Igual que el listado, pero con el detalle de cada bloque (no solo el
// total) — lo necesita el export a Excel para reconstruir la grilla de
// 12 meses del formato original. Mismo scoping/filtros que el listado.
router.get("/exportar", requireAuth, requireFirmante, async (req, res) => {
  const anio = parseInt(req.query.anio) || new Date().getFullYear();
  const { unidad_organica_id, search } = req.query;
  try {
    const accesoTotal = tieneAccesoTotal(req);
    const values = [anio];
    let i = 2;
    let filtros = "";
    if (!accesoTotal) {
      filtros += ` AND (u.jefe_id = $${i} OR u.jefe_superior_id = $${i})`;
      values.push(req.user.firmante_id);
      i++;
    }
    if (unidad_organica_id) {
      filtros += ` AND u.id = $${i}`;
      values.push(unidad_organica_id);
      i++;
    }
    if (search) {
      filtros += ` AND (sv.nombres ILIKE $${i} OR sv.numero_identificacion ILIKE $${i})`;
      values.push(`%${search}%`);
      i++;
    }

    const { rows } = await pool.query(
      `
      SELECT
        sv.id AS servidor_id, sv.nombres, sv.numero_identificacion AS cedula,
        d.nombre AS denominacion,
        COALESCE(
          json_agg(
            json_build_object(
              'fecha_desde', b.fecha_desde,
              'fecha_hasta', b.fecha_hasta,
              'dias', b.dias
            ) ORDER BY b.fecha_desde
          ) FILTER (WHERE b.id IS NOT NULL),
          '[]'
        ) AS bloques
      FROM core.asignacion_puesto ap
      JOIN core.puesto p ON p.id = ap.puesto_id
      JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      JOIN core.servidor sv ON sv.id = ap.servidor_id
      LEFT JOIN core.denominacion_puesto d ON d.id = p.denominacion_puesto_id
      LEFT JOIN core.cronograma_vacaciones_bloque b
        ON b.servidor_id = sv.id AND b.anio = $1
      WHERE ap.estado = 'ACTIVA' AND sv.activo = true
      ${filtros}
      GROUP BY sv.id, sv.nombres, sv.numero_identificacion, d.nombre
      ORDER BY sv.nombres ASC
      `,
      values,
    );

    return res.json({ anio, data: rows });
  } catch (err) {
    console.error("Error exportando cronograma de vacaciones:", err);
    return res
      .status(500)
      .json({ message: "Error exportando cronograma de vacaciones" });
  }
});

// GET /api/cronograma-vacaciones/unidades-resumen?anio=2026
// Cuántos servidores de cada unidad ya tienen al menos un bloque
// planificado ese año (ej. 4/5) — alimenta el filtro de unidad para que
// se note de un vistazo a quién le falta planificar. Mismo scoping por
// jefe que el resto del módulo.
router.get(
  "/unidades-resumen",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    try {
      const accesoTotal = tieneAccesoTotal(req);
      const values = [anio];
      let scoping = "";
      if (!accesoTotal) {
        scoping = " AND (u.jefe_id = $2 OR u.jefe_superior_id = $2)";
        values.push(req.user.firmante_id);
      }
      const { rows } = await pool.query(
        `
        SELECT
          u.id, u.nombre,
          COUNT(DISTINCT sv.id)::int AS total_servidores,
          COUNT(DISTINCT sv.id) FILTER (WHERE b.id IS NOT NULL)::int AS con_cronograma
        FROM core.unidad_organica u
        JOIN core.puesto p ON p.unidad_organica_id = u.id
        JOIN core.asignacion_puesto ap ON ap.puesto_id = p.id AND ap.estado = 'ACTIVA'
        JOIN core.servidor sv ON sv.id = ap.servidor_id AND sv.activo = true
        LEFT JOIN core.cronograma_vacaciones_bloque b
          ON b.servidor_id = sv.id AND b.anio = $1
        WHERE u.activo = true
        ${scoping}
        GROUP BY u.id, u.nombre
        ORDER BY u.nombre ASC
        `,
        values,
      );
      return res.json(rows);
    } catch (err) {
      console.error("Error obteniendo resumen de unidades:", err);
      return res
        .status(500)
        .json({ message: "Error obteniendo resumen de unidades" });
    }
  },
);

// GET /api/cronograma-vacaciones/servidor/:servidorId?anio=2026
// Bloques de un servidor en un año puntual.
router.get(
  "/servidor/:servidorId",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { servidorId } = req.params;
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    try {
      if (!(await puedeGestionarServidor(req, servidorId))) {
        return res.status(403).json({
          message: "No autorizado para ver el cronograma de este servidor",
        });
      }
      const { rows } = await pool.query(
        `SELECT id, fecha_desde, fecha_hasta, dias
         FROM core.cronograma_vacaciones_bloque
         WHERE servidor_id = $1 AND anio = $2
         ORDER BY fecha_desde ASC`,
        [servidorId, anio],
      );
      const totalDias = rows.reduce((acc, b) => acc + b.dias, 0);
      return res.json({
        anio,
        tope_dias_anual: TOPE_DIAS_ANUAL,
        total_dias: totalDias,
        bloques: rows,
      });
    } catch (err) {
      console.error("Error obteniendo bloques de vacaciones:", err);
      return res
        .status(500)
        .json({ message: "Error obteniendo bloques de vacaciones" });
    }
  },
);

// POST /api/cronograma-vacaciones
// Crea un bloque nuevo para un servidor.
router.post("/", requireAuth, requireFirmante, async (req, res) => {
  const { servidor_id, fecha_desde, fecha_hasta } = req.body;

  if (!servidor_id || !fecha_desde || !fecha_hasta) {
    return res.status(400).json({
      message: "servidor_id, fecha_desde y fecha_hasta son requeridos",
    });
  }
  if (new Date(fecha_hasta) < new Date(fecha_desde)) {
    return res
      .status(400)
      .json({ message: "La fecha hasta no puede ser anterior a la fecha desde" });
  }

  const anio = anioDeFecha(fecha_desde);
  const dias = diasEntre(fecha_desde, fecha_hasta);

  try {
    if (!(await puedeGestionarServidor(req, servidor_id))) {
      return res.status(403).json({
        message: "No autorizado para planificar vacaciones de este servidor",
      });
    }

    const existentes = await pool.query(
      `SELECT id, fecha_desde, fecha_hasta, dias
       FROM core.cronograma_vacaciones_bloque
       WHERE servidor_id = $1 AND anio = $2`,
      [servidor_id, anio],
    );

    const seSolapa = existentes.rows.some(
      (b) =>
        new Date(fecha_desde) <= new Date(b.fecha_hasta) &&
        new Date(fecha_hasta) >= new Date(b.fecha_desde),
    );
    if (seSolapa) {
      return res.status(409).json({
        message: "Las fechas se cruzan con otro bloque ya planificado de este servidor",
      });
    }

    const totalActual = existentes.rows.reduce((acc, b) => acc + b.dias, 0);
    if (totalActual + dias > TOPE_DIAS_ANUAL) {
      return res.status(400).json({
        message: `Supera el tope de ${TOPE_DIAS_ANUAL} días anuales (ya tiene ${totalActual}, este bloque son ${dias})`,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO core.cronograma_vacaciones_bloque
        (servidor_id, anio, fecha_desde, fecha_hasta, dias, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, fecha_desde, fecha_hasta, dias`,
      [servidor_id, anio, fecha_desde, fecha_hasta, dias, req.user.firmante_id],
    );

    // Avisa al servidor dentro del sistema (campana/toast ya existentes,
    // sin SSE) para que pueda solicitar estas vacaciones con un clic. Solo
    // al crear el bloque, no en cada edición, para no generar spam.
    await pool.query(
      `INSERT INTO core.notificacion_permiso (servidor_id, tipo, cronograma_bloque_id)
       VALUES ($1, 'CRONOGRAMA_PROGRAMADA', $2)`,
      [servidor_id, rows[0].id],
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error creando bloque de vacaciones:", err);
    return res
      .status(500)
      .json({ message: "Error creando bloque de vacaciones" });
  }
});

// PUT /api/cronograma-vacaciones/:id
router.put("/:id", requireAuth, requireFirmante, async (req, res) => {
  const { id } = req.params;
  const { fecha_desde, fecha_hasta } = req.body;

  if (!fecha_desde || !fecha_hasta) {
    return res
      .status(400)
      .json({ message: "fecha_desde y fecha_hasta son requeridos" });
  }
  if (new Date(fecha_hasta) < new Date(fecha_desde)) {
    return res
      .status(400)
      .json({ message: "La fecha hasta no puede ser anterior a la fecha desde" });
  }

  try {
    const bloqueR = await pool.query(
      `SELECT servidor_id, anio FROM core.cronograma_vacaciones_bloque WHERE id = $1`,
      [id],
    );
    if (!bloqueR.rows.length) {
      return res.status(404).json({ message: "Bloque no encontrado" });
    }
    const { servidor_id, anio } = bloqueR.rows[0];

    if (!(await puedeGestionarServidor(req, servidor_id))) {
      return res.status(403).json({
        message: "No autorizado para editar las vacaciones de este servidor",
      });
    }

    const nuevoAnio = anioDeFecha(fecha_desde);
    const dias = diasEntre(fecha_desde, fecha_hasta);

    const existentes = await pool.query(
      `SELECT id, fecha_desde, fecha_hasta, dias
       FROM core.cronograma_vacaciones_bloque
       WHERE servidor_id = $1 AND anio = $2 AND id <> $3`,
      [servidor_id, nuevoAnio, id],
    );

    const seSolapa = existentes.rows.some(
      (b) =>
        new Date(fecha_desde) <= new Date(b.fecha_hasta) &&
        new Date(fecha_hasta) >= new Date(b.fecha_desde),
    );
    if (seSolapa) {
      return res.status(409).json({
        message: "Las fechas se cruzan con otro bloque ya planificado de este servidor",
      });
    }

    const totalActual = existentes.rows.reduce((acc, b) => acc + b.dias, 0);
    if (totalActual + dias > TOPE_DIAS_ANUAL) {
      return res.status(400).json({
        message: `Supera el tope de ${TOPE_DIAS_ANUAL} días anuales (ya tiene ${totalActual} en otros bloques, este bloque son ${dias})`,
      });
    }

    const { rows } = await pool.query(
      `UPDATE core.cronograma_vacaciones_bloque
       SET fecha_desde = $1, fecha_hasta = $2, dias = $3, anio = $4
       WHERE id = $5
       RETURNING id, fecha_desde, fecha_hasta, dias`,
      [fecha_desde, fecha_hasta, dias, nuevoAnio, id],
    );

    return res.json(rows[0]);
  } catch (err) {
    console.error("Error actualizando bloque de vacaciones:", err);
    return res
      .status(500)
      .json({ message: "Error actualizando bloque de vacaciones" });
  }
});

// DELETE /api/cronograma-vacaciones/:id
router.delete("/:id", requireAuth, requireFirmante, async (req, res) => {
  const { id } = req.params;
  try {
    const bloqueR = await pool.query(
      `SELECT servidor_id FROM core.cronograma_vacaciones_bloque WHERE id = $1`,
      [id],
    );
    if (!bloqueR.rows.length) {
      return res.status(404).json({ message: "Bloque no encontrado" });
    }
    if (!(await puedeGestionarServidor(req, bloqueR.rows[0].servidor_id))) {
      return res.status(403).json({
        message: "No autorizado para eliminar las vacaciones de este servidor",
      });
    }
    // La notificación "tienes vacaciones programadas" pierde sentido si el
    // bloque se elimina, y además bloquea el DELETE por la FK que agregamos
    // en notificacion_permiso.cronograma_bloque_id.
    await pool.query(
      `DELETE FROM core.notificacion_permiso WHERE cronograma_bloque_id = $1`,
      [id],
    );
    await pool.query(
      `DELETE FROM core.cronograma_vacaciones_bloque WHERE id = $1`,
      [id],
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Error eliminando bloque de vacaciones:", err);
    return res
      .status(500)
      .json({ message: "Error eliminando bloque de vacaciones" });
  }
});

export default router;
