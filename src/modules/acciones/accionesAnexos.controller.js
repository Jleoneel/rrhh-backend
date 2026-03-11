import fs from "fs";
import path from "path";
import { pool } from "../../db.js";

const baseUploads = path.resolve(process.env.UPLOADS_DIR || "uploads");

// Función helper para obtener ruta con código
async function getAnexosDir(accionId) {
  const { rows } = await pool.query(
    `SELECT codigo_elaboracion FROM core.accion_personal WHERE id = $1`,
    [accionId]
  );
  const codigo = rows[0]?.codigo_elaboracion || accionId;
  return path.join(baseUploads, "acciones", codigo, "anexos");
}

//
export const listar = async (req, res) => {
  const { accionId } = req.params;
  const { rows } = await pool.query(
    `
    SELECT 
      a.id, 
      a.nombre_original, 
      a.nombre_archivo, 
      a.mime_type, 
      a.tamano_bytes, 
      a.ruta_relativa, 
      a.created_at,
      ap.codigo_elaboracion
    FROM core.accion_personal_anexo a
    JOIN core.accion_personal ap ON ap.id = a.accion_personal_id
    WHERE a.accion_personal_id = $1
    ORDER BY a.created_at DESC
    `,
    [accionId]
  );

  res.json(rows);
};

// Subir anexo: solo si acción está en BORRADOR
export const subir = async (req, res) => {
  const { accionId } = req.params;

  if (!req.file) {
    return res.status(400).json({ message: "Archivo requerido" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: accion } = await client.query(
      `SELECT estado, codigo_elaboracion FROM core.accion_personal WHERE id = $1`,
      [accionId]
    );

    if (!accion.length) throw new Error("Acción no existe");
    if (accion[0].estado !== "BORRADOR") 
      throw new Error("Solo se pueden subir anexos en BORRADOR");

    const codigo = accion[0].codigo_elaboracion;
    const rutaRelativa = `/uploads/acciones/${codigo}/anexos/${req.file.filename}`;

    const { rows } = await client.query(
      `
      INSERT INTO core.accion_personal_anexo
        (accion_personal_id, nombre_original, nombre_archivo, mime_type, tamano_bytes, ruta_relativa)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        accionId,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        rutaRelativa,
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({
      ...rows[0],
      codigo_elaboracion: codigo 
    });
  } catch (e) {
    await client.query("ROLLBACK");
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(400).json({ message: e.message });
  } finally {
    client.release();
  }
};

// Eliminar anexo: solo si acción está en BORRADOR
export const eliminar = async (req, res) => {
  const { accionId, anexoId } = req.params;

  const { rows: accion } = await pool.query(
    `SELECT estado, codigo_elaboracion FROM core.accion_personal WHERE id = $1`,
    [accionId]
  );

  if (!accion.length) return res.status(404).json({ message: "Acción no existe" });

  if (accion[0].estado !== "BORRADOR") {
    return res.status(409).json({ message: "Solo se pueden eliminar anexos en BORRADOR" });
  }

  const { rows } = await pool.query(
    `
    DELETE FROM core.accion_personal_anexo
    WHERE id = $1 AND accion_personal_id = $2
    RETURNING nombre_archivo
    `,
    [anexoId, accionId]
  );

  if (!rows.length) return res.status(404).json({ message: "Anexo no encontrado" });

  try {
    const anexosDir = path.join(baseUploads, "acciones", accion[0].codigo_elaboracion, "anexos");
    fs.unlinkSync(path.join(anexosDir, rows[0].nombre_archivo));
  } catch (_) {}

  res.json({ ok: true });
};

// Descargar anexo: disponible para cualquier estado de la acción
export const descargar = async (req, res) => {
  const { accionId, anexoId } = req.params;

  const { rows } = await pool.query(
    `
    SELECT 
      a.nombre_original, 
      a.nombre_archivo,
      ap.codigo_elaboracion
    FROM core.accion_personal_anexo a
    JOIN core.accion_personal ap ON ap.id = a.accion_personal_id
    WHERE a.id = $1 AND a.accion_personal_id = $2
    `,
    [anexoId, accionId]
  );

  if (!rows.length) return res.status(404).json({ message: "Archivo no encontrado" });

  const filePath = path.join(
    baseUploads, 
    "acciones", 
    rows[0].codigo_elaboracion, 
    "anexos", 
    rows[0].nombre_archivo
  );
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Archivo no existe en disco" });
  }

  res.download(filePath, rows[0].nombre_original);
};