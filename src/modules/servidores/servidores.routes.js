import { Router } from "express";
import { pool } from "../../db.js";
import { resetPasswordServidor } from "./servidores.controller.js";
import {
  requireAuth,
  requireFirmante,
} from "../../shared/middleware/auth.middleware.js";
import { requireCargo } from "../../shared/middleware/requireCargo.middleware.js";
import { CARGO_IDS } from "../../shared/constants/cargos.js";

const router = Router();
// GET /api/servidores/:cedula/situacion-actual
router.get("/:cedula/situacion-actual", async (req, res) => {
  const { cedula } = req.params;

  const sql = `
    SELECT
      sv.id AS servidor_id,
      p.id AS puesto_id,

      sv.numero_identificacion AS cedula,
      sv.nombres,
      sv.canton AS lugar_trabajo,

      p.partida_individual,
      p.estado_puesto,
      p.grado,
      p.rmu_puesto,

      u.id AS unidad_organica_id,
      u.nombre AS unidad_organica,

      d.id AS denominacion_puesto_id,
      d.nombre AS denominacion_puesto,

      eo.id AS escala_ocupacional_id,
      eo.nombre AS grupo_ocupacional,

      p.nivel_gestion_id,
      ng.nombre AS nivel_gestion

    FROM core.servidor sv
    JOIN core.asignacion_puesto ap
      ON ap.servidor_id = sv.id
     AND ap.estado = 'ACTIVA'
    JOIN core.puesto p
      ON p.id = ap.puesto_id
    JOIN core.unidad_organica u
      ON u.id = p.unidad_organica_id
    JOIN core.denominacion_puesto d
      ON d.id = p.denominacion_puesto_id
    LEFT JOIN core.escala_ocupacional eo
      ON eo.id = p.escala_ocupacional_id

    LEFT JOIN core.nivel_gestion ng
      ON ng.id = p.nivel_gestion_id

    WHERE sv.numero_identificacion = $1
    ORDER BY ap.fecha_inicio DESC NULLS LAST
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [cedula]);
  if (!rows.length)
    return res.status(404).json({ message: "Servidor no encontrado" });
  res.json(rows[0]);
});

// POST /api/servidores/manual
// Registra un servidor que NO consta en el distributivo (origen='MANUAL'),
// junto con un puesto sintético y su asignación activa, para poder crear
// una Acción de Personal sin depender de que exista previamente en el
// Excel institucional. A partir de aquí el servidor se comporta igual que
// uno del distributivo: GET /:cedula/situacion-actual lo encuentra por el
// mismo JOIN, y POST /api/acciones no requiere ningún cambio.
router.post(
  "/manual",
  requireAuth,
  requireCargo([CARGO_IDS.ASISTENTE_UATH]),
  async (req, res) => {
    const numeroIdentificacion = String(
      req.body?.numero_identificacion ?? "",
    ).trim();
    const nombres = String(req.body?.nombres ?? "").trim();
    const regimenLaboralId = req.body?.regimen_laboral_id || null;
    const unidadOrganicaId = req.body?.unidad_organica_id || null;
    const denominacionPuestoId = req.body?.denominacion_puesto_id || null;
    const canton = req.body?.canton
      ? String(req.body.canton).trim()
      : null;
    const escalaOcupacionalId = req.body?.escala_ocupacional_id || null;
    const grado = req.body?.grado ? String(req.body.grado).trim() : null;
    const partidaIndividual = String(
      req.body?.partida_individual ?? "",
    ).trim();
    // rmu_puesto NUNCA se toma del body: se deriva server-side desde
    // escala + grado (misma fuente que GET /catalogos/rmu), igual que en
    // el formulario normal, donde el campo es de solo lectura.

    if (!/^\d{9,10}$/.test(numeroIdentificacion)) {
      return res
        .status(400)
        .json({ message: "La cédula debe tener 9 o 10 dígitos numéricos" });
    }
    if (!nombres) {
      return res.status(400).json({ message: "Los nombres son requeridos" });
    }
    if (!regimenLaboralId) {
      return res
        .status(400)
        .json({ message: "El régimen laboral es requerido" });
    }
    if (!unidadOrganicaId) {
      return res
        .status(400)
        .json({ message: "La unidad administrativa es requerida" });
    }
    if (!denominacionPuestoId) {
      return res
        .status(400)
        .json({ message: "La denominación de puesto es requerida" });
    }
    if (!partidaIndividual) {
      return res
        .status(400)
        .json({ message: "La partida individual es requerida" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const dup = await client.query(
        `SELECT id FROM core.servidor WHERE numero_identificacion = $1 LIMIT 1`,
        [numeroIdentificacion],
      );
      if (dup.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message:
            "Ya existe un servidor registrado con esta cédula. Utilice la opción 'Servidor registrado en distributivo'.",
        });
      }

      const [regimenR, unidadR, denomR] = await Promise.all([
        client.query(`SELECT id FROM core.regimen_laboral WHERE id = $1`, [
          regimenLaboralId,
        ]),
        client.query(`SELECT id FROM core.unidad_organica WHERE id = $1`, [
          unidadOrganicaId,
        ]),
        client.query(
          `SELECT id FROM core.denominacion_puesto WHERE id = $1`,
          [denominacionPuestoId],
        ),
      ]);
      if (!regimenR.rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "El régimen laboral seleccionado no existe" });
      }
      if (!unidadR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "La unidad administrativa seleccionada no existe",
        });
      }
      if (!denomR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "La denominación de puesto seleccionada no existe",
        });
      }
      if (escalaOcupacionalId) {
        const escalaR = await client.query(
          `SELECT id FROM core.escala_ocupacional WHERE id = $1`,
          [escalaOcupacionalId],
        );
        if (!escalaR.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "La escala ocupacional seleccionada no existe",
          });
        }
      }

      // RMU: igual que /catalogos/rmu, se calcula desde escala+grado sobre
      // los puestos ya existentes. Si la combinación no tiene precedente,
      // queda NULL (no se inventa un valor ni se confía en el del cliente).
      let rmuPuesto = null;
      if (escalaOcupacionalId && grado) {
        const rmuR = await client.query(
          `
          SELECT MAX(rmu_puesto) AS rmu
          FROM core.puesto
          WHERE escala_ocupacional_id = $1
            AND grado = $2
            AND rmu_puesto IS NOT NULL;
          `,
          [escalaOcupacionalId, grado],
        );
        rmuPuesto = rmuR.rows[0]?.rmu ?? null;
      }

      const servidorR = await client.query(
        `
        INSERT INTO core.servidor
          (tipo_identificacion, numero_identificacion, nombres, estado_servidor, origen, canton)
        VALUES ('Cedula', $1, $2, 'ACTIVO', 'MANUAL', $3)
        RETURNING id;
        `,
        [numeroIdentificacion, nombres, canton],
      );
      const servidorId = servidorR.rows[0].id;

      const puestoR = await client.query(
        `
        INSERT INTO core.puesto
          (regimen_laboral_id, codigo_modalidad_laboral, partida_individual,
           unidad_organica_id, denominacion_puesto_id, escala_ocupacional_id,
           grado, rmu_puesto, origen)
        VALUES ($1, 'MANUAL', $2, $3, $4, $5, $6, $7, 'MANUAL')
        RETURNING id;
        `,
        [
          regimenLaboralId,
          partidaIndividual,
          unidadOrganicaId,
          denominacionPuestoId,
          escalaOcupacionalId,
          grado,
          rmuPuesto,
        ],
      );
      const puestoId = puestoR.rows[0].id;

      await client.query(
        `
        INSERT INTO core.asignacion_puesto (puesto_id, servidor_id, fecha_inicio, estado)
        VALUES ($1, $2, CURRENT_DATE, 'ACTIVA');
        `,
        [puestoId, servidorId],
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "Servidor registrado correctamente",
        servidor_id: servidorId,
        puesto_id: puestoId,
        numero_identificacion: numeroIdentificacion,
        nombres,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        return res.status(409).json({
          message:
            "Ya existe un registro con estos datos (cédula o partida individual duplicada).",
        });
      }
      console.error("Error registrando servidor manual:", error);
      return res
        .status(500)
        .json({ message: "No se pudo registrar el servidor" });
    } finally {
      client.release();
    }
  },
);

// PATCH /api/servidores/:id/reset-password
router.patch(
  "/:id/reset-password",
  requireAuth,
  requireFirmante,
  resetPasswordServidor,
);

export default router;
