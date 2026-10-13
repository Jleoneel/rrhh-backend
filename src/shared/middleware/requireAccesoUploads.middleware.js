import { pool } from "../../db.js";

// Protege /uploads/acciones/<codigo_elaboracion>/... (PDFs firmados y
// anexos de una Acción de Personal): solo personal UATH/jefes (FIRMANTE) o
// el servidor dueño de esa Acción pueden verla — antes de esto, cualquier
// empleado con sesión podía descargar los documentos de cualquier otro
// (requireAuth a secas no distingue de quién es el archivo). El resto de
// /uploads (certificados, etc.) sigue cubierto solo por requireAuth: ningún
// flujo del sistema los sirve de vuelta por HTTP, así que no hace falta
// este nivel de detalle ahí.
export async function requireAccesoUploads(req, res, next) {
  const match = req.path.match(/^\/acciones\/([^/]+)\//);
  if (!match) return next();

  // El Administrador del Sistema siempre pasa, explícito — no depender de
  // que hoy el admin también sea FIRMANTE, por si esa relación cambia.
  if (req.user?.es_admin === true) return next();
  if (req.user?.tipo_usuario === "FIRMANTE") return next();

  const codigo = decodeURIComponent(match[1]);
  try {
    const { rows } = await pool.query(
      `SELECT servidor_id FROM core.accion_personal WHERE codigo_elaboracion = $1`,
      [codigo],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "No encontrado" });
    }
    if (
      req.user?.tipo_usuario === "SERVIDOR" &&
      req.user.servidor_id === rows[0].servidor_id
    ) {
      return next();
    }
    return res.status(403).json({
      message: "No autorizado para ver los documentos de esta acción",
    });
  } catch (err) {
    return res.status(500).json({
      message: "Error validando acceso al archivo",
      error: err.message,
    });
  }
}
