import { pool } from "../../db.js";
import { cargoPuedeActuarComo } from "../constants/cargos.js";

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

      // El Administrador del Sistema pasa cualquier requireCargo, sin
      // importar la lista de cargos permitidos que reciba cada ruta —
      // misma fuente de verdad (ADMIN_CARGO_ID) que usa el login para
      // decidir es_admin, así no hay que mantener la lista de cargos
      // permitidos de cada endpoint actualizada a mano para incluirlo.
      const adminCargoId = (process.env.ADMIN_CARGO_ID || "").trim();
      const esAdmin = adminCargoId !== "" && cargoId === adminCargoId;

      const autorizado =
        esAdmin ||
        cargosPermitidos.some((cargoPermitido) =>
          cargoPuedeActuarComo(cargoId, cargoPermitido),
        );

      if (!autorizado) {
        return res.status(403).json({
          message: "No autorizado para realizar esta operación",
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
