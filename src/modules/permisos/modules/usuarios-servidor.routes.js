import { Router } from "express";
import { pool } from "../../../db.js";
import bcrypt from "bcrypt";
import {
  requireAuth,
  requireFirmante,
} from "../../../shared/middleware/auth.middleware.js";

const router = Router();

// GET /api/permisos/usuarios-servidor
router.get(
  "/usuarios-servidor",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { page = 1, limit = 10, search = "", filtro = "todos" } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    try {
      // Condiciones de filtro
      let whereClause = `WHERE 1=1`;
      const values = [];
      let i = 1;

      if (search) {
        whereClause += ` AND (sv.nombres ILIKE $${i} OR sv.numero_identificacion ILIKE $${i})`;
        values.push(`%${search}%`);
        i++;
      }

      if (filtro === "con_usuario") {
        whereClause += ` AND us.id IS NOT NULL`;
      } else if (filtro === "sin_usuario") {
        whereClause += ` AND us.id IS NULL`;
      }

      // Total para paginación
      const countResult = await pool.query(
        `
      SELECT COUNT(*) AS total
      FROM core.servidor sv
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      LEFT JOIN core.denominacion_puesto d ON d.id = p.denominacion_puesto_id
      LEFT JOIN core.usuario_servidor us ON us.servidor_id = sv.id
      ${whereClause}
    `,
        values,
      );

      const total = parseInt(countResult.rows[0].total);

      // Datos paginados
      const { rows } = await pool.query(
        `
      SELECT
        sv.id AS servidor_id,
        sv.nombres,
        sv.numero_identificacion AS cedula,
        u.nombre AS unidad_organica,
        d.nombre AS denominacion_puesto,
        us.id AS usuario_id,
        us.activo
      FROM core.servidor sv
      LEFT JOIN core.asignacion_puesto ap ON ap.servidor_id = sv.id AND ap.estado = 'ACTIVA'
      LEFT JOIN core.puesto p ON p.id = ap.puesto_id
      LEFT JOIN core.unidad_organica u ON u.id = p.unidad_organica_id
      LEFT JOIN core.denominacion_puesto d ON d.id = p.denominacion_puesto_id
      LEFT JOIN core.usuario_servidor us ON us.servidor_id = sv.id
      ${whereClause}
      ORDER BY sv.nombres ASC
      LIMIT $${i} OFFSET $${i + 1}
    `,
        [...values, parseInt(limit), offset],
      );

      return res.json({
        data: rows,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error obteniendo servidores", error: err.message });
    }
  },
);

// POST /api/permisos/usuarios-servidor
router.post(
  "/usuarios-servidor",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { servidor_id, password } = req.body;

    if (!servidor_id || !password) {
      return res
        .status(400)
        .json({ message: "servidor_id y password son requeridos" });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "La contraseña debe tener al menos 6 caracteres" });
    }

    try {
      const existe = await pool.query(
        `SELECT id FROM core.usuario_servidor WHERE servidor_id = $1`,
        [servidor_id],
      );
      if (existe.rowCount > 0) {
        return res
          .status(409)
          .json({ message: "Este servidor ya tiene usuario creado" });
      }

      const hash = await bcrypt.hash(password.trim(), 10);
      const { rows } = await pool.query(
        `INSERT INTO core.usuario_servidor (servidor_id, password_hash)
       VALUES ($1, $2) RETURNING id, servidor_id, activo, created_at`,
        [servidor_id, hash],
      );
      return res.status(201).json(rows[0]);
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error creando usuario", error: err.message });
    }
  },
);

// PUT /api/permisos/usuarios-servidor/:id
router.put(
  "/usuarios-servidor/:id",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const { id } = req.params;
    const { activo } = req.body;

    try {
      const { rows } = await pool.query(
        `UPDATE core.usuario_servidor SET activo = $1 WHERE id = $2 RETURNING *`,
        [activo, id],
      );
      if (!rows.length)
        return res.status(404).json({ message: "Usuario no encontrado" });
      return res.json(rows[0]);
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Error actualizando usuario", error: err.message });
    }
  },
);

export default router;
