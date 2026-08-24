import { Router } from "express";
import { pool } from "../../db.js";
import { requireAuth } from "../../shared/middleware/auth.middleware.js";
import { requireCargo } from "../../shared/middleware/requireCargo.middleware.js";
import { CARGO_IDS } from "../../shared/constants/cargos.js";

const router = Router();

//UNIDADES ORGÁNICAS
router.get("/unidades-organicas", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, nombre
    FROM core.unidad_organica
    ORDER BY nombre ASC;
  `);
  res.json(rows);
});

// ESCALAS OCUPACIONALES
router.get("/escalas-ocupacionales", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, codigo, nombre
    FROM core.escala_ocupacional
    ORDER BY nombre ASC;
  `);
  res.json(rows);
});

// DENOMINACIONES
router.get("/denominaciones", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, nombre
    FROM core.denominacion_puesto
    ORDER BY nombre ASC;
  `);
  res.json(rows);
});

// POST /api/catalogos/denominaciones
// Crea una nueva denominación de puesto (registro manual desde la app)
router.post(
  "/denominaciones",
  requireAuth,
  requireCargo([CARGO_IDS.ASISTENTE_UATH]),
  async (req, res) => {
    const codigoLegacy = String(req.body?.codigo_legacy ?? "").trim();
    const nombre = String(req.body?.nombre ?? "").trim();

    if (!codigoLegacy) {
      return res.status(400).json({ message: "El código legacy es requerido" });
    }
    if (!nombre) {
      return res.status(400).json({ message: "El nombre es requerido" });
    }

    try {
      const { rows: duplicados } = await pool.query(
        `
        SELECT 1
        FROM core.denominacion_puesto
        WHERE UPPER(codigo_legacy) = UPPER($1)
           OR UPPER(nombre) = UPPER($2)
        LIMIT 1;
        `,
        [codigoLegacy, nombre],
      );

      if (duplicados.length > 0) {
        return res.status(409).json({
          message: "Ya existe una denominación con ese código o nombre",
        });
      }

      const { rows } = await pool.query(
        `
        INSERT INTO core.denominacion_puesto (codigo_legacy, nombre, origen)
        VALUES ($1, $2, 'manual')
        RETURNING id, codigo_legacy, nombre, origen;
        `,
        [codigoLegacy, nombre],
      );

      return res.status(201).json({
        message: "Denominación creada correctamente",
        denominacion: rows[0],
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          message: "Ya existe una denominación con ese código",
        });
      }
      console.error("Error creando denominación de puesto:", error);
      return res
        .status(500)
        .json({ message: "No se pudo crear la denominación" });
    }
  },
);

//LUGARES DE TRABAJO
router.get("/lugares-trabajo", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT canton AS nombre
    FROM core.servidor
    WHERE canton IS NOT NULL
    ORDER BY canton ASC;
  `);
  res.json(rows);
});

// GET /api/catalogos/grados?escala_ocupacional_id=UUID
router.get("/grados", requireAuth, async (req, res) => {
  const { escala_ocupacional_id } = req.query;

  if (!escala_ocupacional_id) {
    return res
      .status(400)
      .json({ message: "escala_ocupacional_id es requerido" });
  }

  const { rows } = await pool.query(
    `
    SELECT DISTINCT p.grado
    FROM core.puesto p
    WHERE p.escala_ocupacional_id = $1
      AND p.grado IS NOT NULL
    ORDER BY p.grado ASC;
    `,
    [escala_ocupacional_id],
  );

  res.json(rows);
});

// GET /api/catalogos/grados?escala_ocupacional_id=UUID
router.get("/rmu", requireAuth, async (req, res) => {
  const { escala_ocupacional_id, grado } = req.query;
  if (!escala_ocupacional_id || !grado) {
    return res
      .status(400)
      .json({ message: "escala_ocupacional_id y grado son requeridos" });
  }

  const { rows } = await pool.query(
    `
    SELECT MAX(rmu_puesto) AS rmu
    FROM core.puesto
    WHERE escala_ocupacional_id = $1
      AND grado = $2
      AND rmu_puesto IS NOT NULL;
    `,
    [escala_ocupacional_id, grado],
  );

  res.json({ rmu: rows[0]?.rmu ?? null });
});
//PROCESO INSTITUCIONAL
router.get("/procesos-institucionales", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, codigo, nombre
    FROM core.proceso_institucional
    WHERE activo = true
    ORDER BY nombre ASC;
  `);
  res.json(rows);
});

//NIVELES DE GESTION
router.get("/niveles-gestion", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, codigo, nombre
    FROM core.nivel_gestion
    WHERE activo = true
    ORDER BY nombre ASC;
  `);
  res.json(rows);
});

export default router;
