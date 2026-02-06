import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// GET /api/servidores/:cedula/situacion-actual
router.get("/:cedula/situacion-actual", async (req, res) => {
  const { cedula } = req.params;

  const sql = `
    SELECT
      sv.id AS servidor_id,
      ap.id AS asignacion_puesto_id,
      p.id AS puesto_id,

      sv.numero_identificacion AS cedula,
      sv.nombres,
      sv.canton AS lugar_trabajo,

      rl.codigo AS cod_regimen,
      rl.nombre AS regimen_laboral,

      p.partida_individual,
      p.estado_puesto,
      p.grado,
      p.rmu_puesto,

      u.id AS unidad_organica_id,
      u.codigo_legacy AS cod_unidad_organica,
      u.nombre AS unidad_organica,

      d.id AS denominacion_puesto_id,
      d.codigo_legacy AS cod_denominacion,
      d.nombre AS denominacion_puesto,

      eo.id AS escala_ocupacional_id,
      eo.codigo AS cod_grupo_ocupacional,
      eo.nombre AS grupo_ocupacional
    FROM core.servidor sv
    JOIN core.asignacion_puesto ap
      ON ap.servidor_id = sv.id
     AND ap.estado = 'ACTIVA'
    JOIN core.puesto p
      ON p.id = ap.puesto_id
    JOIN core.regimen_laboral rl
      ON rl.id = p.regimen_laboral_id
    JOIN core.unidad_organica u
      ON u.id = p.unidad_organica_id
    JOIN core.denominacion_puesto d
      ON d.id = p.denominacion_puesto_id
    LEFT JOIN core.escala_ocupacional eo
      ON eo.id = p.escala_ocupacional_id
    WHERE sv.numero_identificacion = $1
    ORDER BY ap.fecha_inicio DESC NULLS LAST
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [cedula]);
  if (!rows.length) return res.status(404).json({ message: "Servidor no encontrado o sin asignación activa" });
  res.json(rows[0]);
});


export default router;
