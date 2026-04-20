import { Router } from "express";
import { loginByCedula, cambiarPassword } from "./auth.controller.js";
import { requireAuth, requireFirmante } from "../../shared/middleware/auth.middleware.js";
import bcrypt from "bcryptjs";
import { pool } from "../../db.js";

const router = Router();

router.post("/login", loginByCedula);
router.put("/cambiar-password", requireAuth, cambiarPassword);
// POST /api/auth/crear-cuentas-masivo
router.post(
  "/crear-cuentas-masivo",
  requireAuth,
  requireFirmante,
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Traer servidores sin cuenta
      const servidoresR = await client.query(`
        SELECT sv.id, sv.nombres, sv.numero_identificacion
            FROM core.servidor sv
            WHERE NOT EXISTS (
        SELECT 1 FROM core.usuario_servidor us 
            WHERE us.servidor_id = sv.id)`);
      if (!servidoresR.rows.length) {
        await client.query("ROLLBACK");
        return res.json({
          message: "Todos los servidores ya tienen cuenta",
          creados: 0,
        });
      }

      let creados = 0;
      for (const sv of servidoresR.rows) {
        const hash = await bcrypt.hash(sv.numero_identificacion, 10);
        await client.query(`
        INSERT INTO core.usuario_servidor (servidor_id, password_hash)
            VALUES ($1, $2)
        ON CONFLICT (servidor_id) DO NOTHING`, 
        [sv.id, hash]);
        creados++;
      }

      await client.query("COMMIT");
      return res.json({
        message: `${creados} cuentas creadas. Contraseña inicial = cédula de cada servidor.`,
        creados,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      return res
        .status(500)
        .json({ message: "Error creando cuentas", error: err.message });
    } finally {
      client.release();
    }
  },
);

export default router;
