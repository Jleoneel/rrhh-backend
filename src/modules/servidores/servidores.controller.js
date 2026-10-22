import bcrypt from "bcrypt";
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
       SET password_hash = $2, debe_cambiar_password = true
       WHERE servidor_id = $1
       RETURNING *`,
      [id, hash]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Servidor no encontrado" });
    }

    // Si esta cédula también tiene cuenta de firmante (jefe de área que
    // además está en el distributivo como servidor, por ejemplo), el login
    // revisa la tabla firmante PRIMERO (ver auth.controller.js) — si existe
    // coincidencia ahí, ni siquiera llega a mirar usuario_servidor. Sin
    // este UPDATE, el reset de arriba no tiene ningún efecto real para esa
    // persona: queda entrando con su password de firmante de siempre,
    // nunca con la que se acaba de resetear.
    const servidorR = await pool.query(
      `SELECT numero_identificacion FROM core.servidor WHERE id = $1`,
      [id],
    );
    const cedula = servidorR.rows[0]?.numero_identificacion;
    let tambienFirmante = false;
    if (cedula) {
      const firmanteR = await pool.query(
        `UPDATE core.firmante
         SET password_hash = $1, debe_cambiar_password = true
         WHERE numero_identificacion = $2
         RETURNING id`,
        [hash, cedula],
      );
      tambienFirmante = firmanteR.rowCount > 0;
    }

    return res.json({
      message: tambienFirmante
        ? "Contraseña actualizada correctamente (también se reseteó su cuenta de firmante, con la misma cédula)"
        : "Contraseña actualizada correctamente",
      servidor_id: rows[0].servidor_id,
      tambien_firmante: tambienFirmante,
    });
  } catch (err) {
    console.error("Error al actualizar contraseña:", err);
    return res.status(500).json({
      message: "Error al actualizar contraseña",
    });
  }
}
