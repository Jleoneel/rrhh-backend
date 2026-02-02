import { pool } from "../db.js";

export function requireCargo(cargosPermitidos = []) {
  return async (req, res, next) => {
    try {
      const firmanteId = req.user?.firmante_id;

      if (!firmanteId) {
        return res.status(401).json({ message: "No autenticado" });
      }

      const sql = `
        SELECT cargo_id
        FROM core.firmante
        WHERE id = $1
          AND activo = true
        LIMIT 1;
      `;
      const { rows } = await pool.query(sql, [firmanteId]);

      if (!rows.length) {
        return res.status(403).json({ message: "Firmante no válido" });
      }

      const cargoId = rows[0].cargo_id;

      if (!cargosPermitidos.includes(cargoId)) {
        return res.status(403).json({
          message: "No autorizado para crear acciones de personal",
        });
      }
      req.user.cargo_id = cargoId;

      next();
    } catch (error) {
      res.status(500).json({
        message: "Error validando cargo",
        error: error.message,
      });
    }
  };
}
