import jwt from "jsonwebtoken";
import { pool } from "../db.js";

export async function loginByCedula(req, res) {
  const { cedula } = req.body;
  if (!cedula) return res.status(400).json({ message: "cedula es requerida" });

  const q = `
    SELECT f.id, f.numero_identificacion, f.nombre, f.cargo_id, f.activo, c.nombre AS cargo_nombre
    FROM core.firmante f
    JOIN core.cargo c ON c.id = f.cargo_id
    WHERE f.numero_identificacion = $1
    LIMIT 1;
  `;

  const r = await pool.query(q, [cedula.trim()]);
  if (r.rowCount === 0) return res.status(404).json({ message: "Firmante no existe" });

  const firmante = r.rows[0];
  if (!firmante.activo) return res.status(403).json({ message: "Firmante inactivo" });

  const token = jwt.sign(
    { sub: firmante.id, cargo_id: firmante.cargo_id, nombre: firmante.nombre },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  return res.json({
    token,
    firmante: {
      id: firmante.id,
      nombre: firmante.nombre,
      cedula: firmante.numero_identificacion,
      cargo_id: firmante.cargo_id,
      cargo_nombre: firmante.cargo_nombre,
    },
  });
}
