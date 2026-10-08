import { Router } from "express";
import { pool } from "../../db.js";
import bcrypt from "bcrypt";
import {
  requireAuth,
  requireFirmante,
} from "../../shared/middleware/auth.middleware.js";
import { requireCargo } from "../../shared/middleware/requireCargo.middleware.js";
import { CARGO_IDS } from "../../shared/constants/cargos.js";

const router = Router();

// GET /api/permisos/jefes
// Por defecto solo unidades activas — ?todas=true trae también las
// desactivadas (para el toggle "Activas / Todas" de la pantalla).
router.get("/jefes", requireAuth, requireFirmante, async (req, res) => {
  const incluirInactivas = req.query.todas === "true";
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.nombre AS unidad_organica, u.origen, u.activo,
        u.unidad_padre_id, up.nombre AS unidad_padre_nombre,
        f1.id AS jefe_id, f1.nombre AS jefe_nombre,
        f2.id AS jefe_superior_id, f2.nombre AS jefe_superior_nombre
      FROM core.unidad_organica u
      LEFT JOIN core.unidad_organica up ON up.id = u.unidad_padre_id
      LEFT JOIN core.firmante f1 ON f1.id = u.jefe_id
      LEFT JOIN core.firmante f2 ON f2.id = u.jefe_superior_id
      ${incluirInactivas ? "" : "WHERE u.activo = true"}
      ORDER BY u.nombre ASC;
    `);
    return res.json(rows);
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error obteniendo jefes", error: err.message });
  }
});

// POST /api/permisos/unidades-organicas
// Crea una unidad orgánica que no consta en el distributivo (origen=
// 'MANUAL'), con su jefe inmediato/superior y, opcionalmente, su unidad
// padre — para reflejar la estructura orgánica real del hospital cuando
// el Excel institucional todavía no la trae.
router.post(
  "/unidades-organicas",
  requireAuth,
  requireCargo([CARGO_IDS.ASISTENTE_UATH]),
  async (req, res) => {
    const nombre = String(req.body?.nombre ?? "").trim();
    const jefeId = req.body?.jefe_id || null;
    const jefeSuperiorId = req.body?.jefe_superior_id || null;
    const unidadPadreId = req.body?.unidad_padre_id || null;

    if (!nombre) {
      return res
        .status(400)
        .json({ message: "El nombre de la unidad es requerido" });
    }

    try {
      const dup = await pool.query(
        `SELECT id FROM core.unidad_organica WHERE UPPER(BTRIM(nombre)) = UPPER(BTRIM($1)) LIMIT 1`,
        [nombre],
      );
      if (dup.rows.length) {
        return res.status(409).json({
          message: "Ya existe una unidad orgánica con ese nombre",
        });
      }

      if (unidadPadreId) {
        const padre = await pool.query(
          `SELECT id FROM core.unidad_organica WHERE id = $1`,
          [unidadPadreId],
        );
        if (!padre.rows.length) {
          return res
            .status(400)
            .json({ message: "La unidad padre seleccionada no existe" });
        }
      }

      if (jefeId) {
        const jefe = await pool.query(
          `SELECT id FROM core.firmante WHERE id = $1`,
          [jefeId],
        );
        if (!jefe.rows.length) {
          return res
            .status(400)
            .json({ message: "El jefe inmediato seleccionado no existe" });
        }
      }

      if (jefeSuperiorId) {
        const jefeSup = await pool.query(
          `SELECT id FROM core.firmante WHERE id = $1`,
          [jefeSuperiorId],
        );
        if (!jefeSup.rows.length) {
          return res
            .status(400)
            .json({ message: "El jefe superior seleccionado no existe" });
        }
      }

      // codigo_legacy es NOT NULL + UNIQUE en la tabla real (no lo es solo
      // para unidades del distributivo): se genera uno sintético para que
      // una unidad manual no choque nunca con un código oficial real.
      const codigoLegacySintetico = `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { rows } = await pool.query(
        `
        INSERT INTO core.unidad_organica
          (codigo_legacy, nombre, origen, jefe_id, jefe_superior_id, unidad_padre_id)
        VALUES ($1, $2, 'MANUAL', $3, $4, $5)
        RETURNING id, nombre, origen, jefe_id, jefe_superior_id, unidad_padre_id;
        `,
        [codigoLegacySintetico, nombre, jefeId, jefeSuperiorId, unidadPadreId],
      );

      return res.status(201).json(rows[0]);
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error creando la unidad orgánica", error: err.message });
    }
  },
);

// POST /api/permisos/unidades-organicas/:id/asignar-servidor
// Traslada a un servidor YA EXISTENTE (de distributivo o manual) a una
// unidad creada manualmente. Cierra su asignación activa anterior (si
// tiene) y crea un puesto sintético (origen='MANUAL') + asignación nueva
// en la unidad destino — igual patrón que POST /api/servidores/manual,
// copiando denominación/escala/grado del puesto anterior para no pedirle
// a Talento Humano que los reingrese (el cargo real de la persona no
// cambia, solo la unidad a la que queda correctamente vinculada).
router.post(
  "/unidades-organicas/:id/asignar-servidor",
  requireAuth,
  requireCargo([CARGO_IDS.ASISTENTE_UATH]),
  async (req, res) => {
    const { id: unidadOrganicaId } = req.params;
    const servidorId = req.body?.servidor_id || null;

    if (!servidorId) {
      return res.status(400).json({ message: "El servidor es requerido" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const unidadR = await client.query(
        `SELECT id FROM core.unidad_organica WHERE id = $1`,
        [unidadOrganicaId],
      );
      if (!unidadR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Unidad no encontrada" });
      }

      const servidorR = await client.query(
        `SELECT id, numero_identificacion, nombres FROM core.servidor WHERE id = $1`,
        [servidorId],
      );
      if (!servidorR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Servidor no encontrado" });
      }

      const puestoActualR = await client.query(
        `
        SELECT ap.id AS asignacion_id, p.unidad_organica_id,
               p.regimen_laboral_id, p.denominacion_puesto_id,
               p.escala_ocupacional_id, p.grado, p.rmu_puesto,
               p.nivel_gestion_id
        FROM core.asignacion_puesto ap
        JOIN core.puesto p ON p.id = ap.puesto_id
        WHERE ap.servidor_id = $1 AND ap.estado = 'ACTIVA'
        LIMIT 1;
        `,
        [servidorId],
      );
      if (!puestoActualR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message:
            "Este servidor no tiene una asignación activa de la cual copiar su cargo. Use 'Registrar servidor manualmente' en su lugar.",
        });
      }
      const puestoActual = puestoActualR.rows[0];

      if (puestoActual.unidad_organica_id === unidadOrganicaId) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "El servidor ya pertenece a esta unidad",
        });
      }

      // Cierra la asignación activa anterior — el servidor se MUEVE, no
      // queda con dos asignaciones activas (hay un índice único parcial
      // en la base que además lo impediría).
      await client.query(
        `UPDATE core.asignacion_puesto SET estado = 'CERRADA', fecha_fin = NOW() WHERE id = $1`,
        [puestoActual.asignacion_id],
      );

      const partidaSintetica = `MANUAL-${servidorR.rows[0].numero_identificacion}-${Date.now()}`;

      const puestoNuevoR = await client.query(
        `
        INSERT INTO core.puesto
          (regimen_laboral_id, codigo_modalidad_laboral, partida_individual,
           unidad_organica_id, denominacion_puesto_id, escala_ocupacional_id,
           grado, rmu_puesto, nivel_gestion_id, origen)
        VALUES ($1, 'MANUAL', $2, $3, $4, $5, $6, $7, $8, 'MANUAL')
        RETURNING id;
        `,
        [
          puestoActual.regimen_laboral_id,
          partidaSintetica,
          unidadOrganicaId,
          puestoActual.denominacion_puesto_id,
          puestoActual.escala_ocupacional_id,
          puestoActual.grado,
          puestoActual.rmu_puesto,
          puestoActual.nivel_gestion_id,
        ],
      );

      await client.query(
        `INSERT INTO core.asignacion_puesto (puesto_id, servidor_id, fecha_inicio, estado) VALUES ($1, $2, CURRENT_DATE, 'ACTIVA')`,
        [puestoNuevoR.rows[0].id, servidorId],
      );

      await client.query("COMMIT");
      return res.status(201).json({
        message: "Servidor trasladado correctamente a la nueva unidad",
        servidor_id: servidorId,
        puesto_id: puestoNuevoR.rows[0].id,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error trasladando al servidor", error: err.message });
    } finally {
      client.release();
    }
  },
);

// GET /api/permisos/unidades-organicas/:id/servidores
// Servidores con asignación ACTIVA en esta unidad — alimenta la pestaña
// "Servidores actuales" del modal de asignación, para que UATH vea quién ya
// pertenece antes de trasladar a alguien más (de solo lectura, por eso
// requireFirmante en vez del requireCargo más estricto de las rutas que
// modifican datos).
router.get(
  "/unidades-organicas/:id/servidores",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await pool.query(
        `
        SELECT
          sv.id AS servidor_id, sv.nombres,
          sv.numero_identificacion AS cedula,
          sv.dias_vacacion_anual,
          d.nombre AS denominacion_puesto,
          p.origen AS puesto_origen
        FROM core.asignacion_puesto ap
        JOIN core.puesto p ON p.id = ap.puesto_id
        JOIN core.servidor sv ON sv.id = ap.servidor_id
        LEFT JOIN core.denominacion_puesto d ON d.id = p.denominacion_puesto_id
        WHERE p.unidad_organica_id = $1 AND ap.estado = 'ACTIVA'
        ORDER BY sv.nombres ASC;
        `,
        [id],
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({
        message: "Error obteniendo servidores de la unidad",
        error: err.message,
      });
    }
  },
);

// PATCH /api/permisos/unidades-organicas/:id/activo
// Activa/desactiva una unidad orgánica — es solo un toggle de visibilidad
// (deja de listarse por defecto en "Gestión de Jefes"), no cierra
// asignaciones de servidores ni afecta jefes ya asignados.
router.patch(
  "/unidades-organicas/:id/activo",
  requireAuth,
  requireCargo([CARGO_IDS.ASISTENTE_UATH]),
  async (req, res) => {
    const { id } = req.params;
    const { activo } = req.body;
    if (typeof activo !== "boolean") {
      return res
        .status(400)
        .json({ message: "El campo 'activo' debe ser booleano" });
    }
    try {
      const { rows } = await pool.query(
        `UPDATE core.unidad_organica SET activo = $1 WHERE id = $2 RETURNING id, activo`,
        [activo, id],
      );
      if (!rows.length) {
        return res.status(404).json({ message: "Unidad no encontrada" });
      }
      return res.json({
        message: activo ? "Unidad activada" : "Unidad desactivada",
        ...rows[0],
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error actualizando la unidad", error: err.message });
    }
  },
);

// PATCH /api/permisos/servidores/:servidorId/dias-vacacion
// Días de vacación anuales que acumula este servidor en particular (ej.
// un auxiliar de enfermería que acumula más que el resto del personal) —
// lo usa acumularSaldos.job.js para calcular el incremento mensual.
// dias_vacacion_anual=null revierte al default del sistema (30). El
// cambio solo aplica hacia adelante: no recalcula lo ya acumulado este año.
router.patch(
  "/servidores/:servidorId/dias-vacacion",
  requireAuth,
  requireCargo([CARGO_IDS.ASISTENTE_UATH]),
  async (req, res) => {
    const { servidorId } = req.params;
    const diasRaw = req.body?.dias_vacacion_anual;

    let dias = null;
    if (diasRaw !== null && diasRaw !== undefined && diasRaw !== "") {
      dias = Number(diasRaw);
      if (!Number.isInteger(dias) || dias <= 0 || dias > 365) {
        return res.status(400).json({
          message:
            "Los días de vacación anuales deben ser un entero entre 1 y 365",
        });
      }
    }

    try {
      const { rows } = await pool.query(
        `UPDATE core.servidor SET dias_vacacion_anual = $1 WHERE id = $2 RETURNING id, dias_vacacion_anual`,
        [dias, servidorId],
      );
      if (!rows.length) {
        return res.status(404).json({ message: "Servidor no encontrado" });
      }
      return res.json({
        message:
          dias === null
            ? "Se quitó la personalización — ahora usa el valor por defecto (30)"
            : "Días de vacación actualizados",
        ...rows[0],
      });
    } catch (err) {
      return res.status(500).json({
        message: "Error actualizando los días de vacación del servidor",
        error: err.message,
      });
    }
  },
);

// PUT /api/permisos/jefes/:unidadId
router.put(
  "/jefes/:unidadId",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { unidadId } = req.params;
    const { jefe_id, jefe_superior_id } = req.body;

    try {
      const { rows } = await pool.query(
        `
      UPDATE core.unidad_organica
      SET jefe_id = $1, jefe_superior_id = $2
      WHERE id = $3
      RETURNING id, nombre, jefe_id, jefe_superior_id
    `,
        [jefe_id || null, jefe_superior_id || null, unidadId],
      );

      if (!rows.length)
        return res.status(404).json({ message: "Unidad no encontrada" });
      return res.json(rows[0]);
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error asignando jefe", error: err.message });
    }
  },
);

// POST /api/permisos/jefes-firmante
router.post(
  "/jefes-firmante",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { cedula, nombre, password, unidad_organica_id } = req.body;

    if (!cedula || !nombre || !password || !unidad_organica_id) {
      return res
        .status(400)
        .json({ message: "Todos los campos son requeridos" });
    }

    if (!/^\d{10}$/.test(cedula.trim())) {
      return res
        .status(400)
        .json({ message: "La cédula debe tener 10 dígitos" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "La contraseña debe tener al menos 6 caracteres" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existe = await client.query(
        `SELECT id FROM core.firmante WHERE numero_identificacion = $1 LIMIT 1`,
        [cedula.trim()],
      );
      if (existe.rowCount > 0) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ message: "Ya existe un usuario con esa cédula" });
      }

      const cargoR = await client.query(
        `SELECT id FROM core.cargo WHERE nombre = 'JEFE DE AREA' AND activo = true LIMIT 1`,
      );
      if (!cargoR.rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "No existe el cargo JEFE DE AREA" });
      }

      const cargo_id = cargoR.rows[0].id;
      const hash = await bcrypt.hash(password.trim(), 10);

      const firmanteR = await client.query(
        `
      INSERT INTO core.firmante (numero_identificacion, nombre, activo, cargo_id, password_hash)
      VALUES ($1, $2, true, $3, $4)
      RETURNING id
    `,
        [cedula.trim(), nombre.trim().toUpperCase(), cargo_id, hash],
      );

      const firmante_id = firmanteR.rows[0].id;

      await client.query(
        `
        UPDATE core.unidad_organica
         SET jefe_id = $1
        WHERE id = $2`,
        [firmante_id, unidad_organica_id],
      );

      await client.query("COMMIT");
      return res
        .status(201)
        .json({ message: "Jefe de área creado y asignado correctamente" });
    } catch (err) {
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error creando jefe", error: err.message });
    } finally {
      client.release();
    }
  },
);

// GET /api/permisos/unidades-posibles-duplicados
// Compara unidades creadas a mano (origen='MANUAL') contra unidades del
// distributivo oficial (origen='EXCEL') por similitud de nombre (pg_trgm),
// para detectar cuando una unidad manual probablemente "llegó" al fin al
// Excel institucional con otro id. Es solo un aviso — no fusiona nada.
router.get(
  "/unidades-posibles-duplicados",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          m.id AS unidad_manual_id, m.nombre AS unidad_manual_nombre,
          e.id AS unidad_excel_id, e.nombre AS unidad_excel_nombre,
          core.similarity(m.nombre, e.nombre) AS similitud
        FROM core.unidad_organica m
        CROSS JOIN core.unidad_organica e
        WHERE UPPER(m.origen) = 'MANUAL' AND UPPER(e.origen) = 'EXCEL'
          AND core.similarity(m.nombre, e.nombre) >= 0.4
          AND NOT EXISTS (
            SELECT 1 FROM core.unidad_duplicado_descartado d
            WHERE d.unidad_manual_id = m.id AND d.unidad_excel_id = e.id
          )
        ORDER BY similitud DESC;
      `);
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({
        message: "Error buscando posibles duplicados",
        error: err.message,
      });
    }
  },
);

// POST /api/permisos/unidades-posibles-duplicados/descartar
// Marca un par (unidad manual, unidad excel) como "no es la misma unidad"
// para que no se vuelva a mostrar — pero sigue detectando cualquier otra
// coincidencia nueva que aparezca.
router.post(
  "/unidades-posibles-duplicados/descartar",
  requireAuth,
  requireCargo([CARGO_IDS.ASISTENTE_UATH]),
  async (req, res) => {
    const unidadManualId = req.body?.unidad_manual_id || null;
    const unidadExcelId = req.body?.unidad_excel_id || null;

    if (!unidadManualId || !unidadExcelId) {
      return res.status(400).json({
        message: "unidad_manual_id y unidad_excel_id son requeridos",
      });
    }

    try {
      await pool.query(
        `
        INSERT INTO core.unidad_duplicado_descartado
          (unidad_manual_id, unidad_excel_id, descartado_por)
        VALUES ($1, $2, $3)
        ON CONFLICT (unidad_manual_id, unidad_excel_id) DO NOTHING;
        `,
        [unidadManualId, unidadExcelId, req.user.firmante_id],
      );
      return res.json({ message: "Descartado correctamente" });
    } catch (err) {
      return res.status(500).json({
        message: "Error descartando el posible duplicado",
        error: err.message,
      });
    }
  },
);

export default router;
