import bcrypt from "bcryptjs";
import { pool } from "../../db.js";

export async function resetPasswordServidor(req, res) {
  const { id } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ message: "password es requerido" });
  }

  try {
    const hash = await bcrypt.hash(String(password), 10);

    const { rows } = await pool.query(
      `UPDATE core.usuario_servidor 
       SET password_hash = $2 
       WHERE servidor_id = $1
       RETURNING *`,
      [id, hash]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Servidor no encontrado" });
    }

    return res.json({
      message: "Contraseña actualizada correctamente",
      servidor_id: rows[0].servidor_id,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Error al actualizar contraseña",
      error: err.message,
    });
  }
}
