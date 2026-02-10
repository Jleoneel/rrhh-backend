import fs from "fs";
import path from "path";
import { pool } from "../db.js";

const baseUploads = path.resolve(process.env.UPLOADS_DIR || "uploads");
const anexosDir = (accionId) => path.join(baseUploads, "acciones", accionId, "anexos");

export const listar = async (req, res) => {
  const { accionId } = req.params;

  const { rows } = await pool.query(
    `
    SELECT id, nombre_original, nombre_archivo, mime_type, tamano_bytes, ruta_relativa, created_at
    FROM core.accion_personal_anexo
    WHERE accion_personal_id = $1
    ORDER BY created_at DESC
    `,
    [accionId]
  );

  res.json(rows);
};

export const subir = async (req, res) => {
  const { accionId } = req.params;

  if (!req.file) {
    return res.status(400).json({ message: "Archivo requerido" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: accion } = await client.query(
      `SELECT estado FROM core.accion_personal WHERE id = $1`,
      [accionId]
    );

    if (!accion.length) throw new Error("Acción no existe");
    if (accion[0].estado !== "BORRADOR") throw new Error("Solo se pueden subir anexos en BORRADOR");

    const rutaRelativa = `/uploads/acciones/${accionId}/anexos/${req.file.filename}`;

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
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(400).json({ message: e.message });
  } finally {
    client.release();
  }
};

export const eliminar = async (req, res) => {
  const { accionId, anexoId } = req.params;

  const { rows: accion } = await pool.query(
    `SELECT estado FROM core.accion_personal WHERE id = $1`,
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
    fs.unlinkSync(path.join(anexosDir(accionId), rows[0].nombre_archivo));
  } catch (_) {}

  res.json({ ok: true });
};

export const descargar = async (req, res) => {
  const { accionId, anexoId } = req.params;

  const { rows } = await pool.query(
    `
    SELECT nombre_original, nombre_archivo
    FROM core.accion_personal_anexo
    WHERE id = $1 AND accion_personal_id = $2
    `,
    [anexoId, accionId]
  );

  if (!rows.length) return res.status(404).json({ message: "Archivo no encontrado" });

  const filePath = path.join(anexosDir(accionId), rows[0].nombre_archivo);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Archivo no existe en disco" });

  res.download(filePath, rows[0].nombre_original);
};
