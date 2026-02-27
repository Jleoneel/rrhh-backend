import { pool } from "../db.js";
import fs from "fs";
import path from "path";

export async function misFirmasPendientes(req, res) {
  const { cargo_id } = req.user;
  

  const q = `
    SELECT
      af.id AS accion_firma_id,
      af.accion_id,
      af.orden,
      af.rol_firma,
      af.estado,
      ta.nombre AS tipo_accion,
      ap.motivo,
      ap.estado AS estado_accion,
      ap.fecha_elaboracion
    FROM core.accion_firma af
    JOIN core.accion_personal ap ON ap.id = af.accion_id
    JOIN core.tipo_accion ta ON ta.id = ap.tipo_accion_id
    WHERE af.estado = 'PENDIENTE'
      AND af.cargo_id = $1
    ORDER BY ap.fecha_elaboracion DESC, af.orden ASC;
  `;

  const r = await pool.query(q, [cargo_id]);
  return res.json({ count: r.rowCount, items: r.rows });
}

export async function eliminarFirma(req, res) {
  const { accionId, firmaId } = req.params;
  const { firmante_id } = req.user; // 👈 debe venir del JWT

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Validar que el documento fue subido por este firmante
    const qFirma = `
      SELECT ad.id AS documento_id, ad.archivo_path
      FROM core.accion_firma af
      JOIN core.accion_documento ad 
        ON ad.id = af.documento_id
      WHERE af.id = $1
        AND af.accion_id = $2
        AND ad.subido_por_firmante_id = $3
    `;

    const rFirma = await client.query(qFirma, [
      firmaId,
      accionId,
      firmante_id
    ]);

    if (!rFirma.rows.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "No tienes permisos para eliminar este documento"
      });
    }

    const documento = rFirma.rows[0];
    const documentoId = documento.documento_id

    // 2️⃣ Quitar referencia y regresar firma a PENDIENTE
    await client.query(
      `
      UPDATE core.accion_firma af
      SET documento_id = NULL,
          estado = 'PENDIENTE',
          firmado_en = NULL,
          observacion = NULL
      FROM core.accion_documento ad
      WHERE af.id = $1
        AND af.documento_id = ad.id
        AND ad.subido_por_firmante_id = $2
      `,
      [firmaId, firmante_id]
    );

    // 3️⃣ Eliminar documento SOLO si pertenece al firmante
    await client.query(
      `
      DELETE FROM core.accion_documento 
      WHERE id = $1 
        AND subido_por_firmante_id = $2
      `,
      [documentoId, firmante_id]
    );
    if (documentoId && documento.archivo_path) {
  const rutaArchivo = path.join(process.cwd(), documento.archivo_path);
  if (fs.existsSync(rutaArchivo)) {
    fs.unlinkSync(rutaArchivo);
  }
}

    // 4️⃣ Recalcular estado de la acción automáticamente
    await client.query(
      `
      UPDATE core.accion_personal ap
SET estado = CASE
  WHEN NOT EXISTS (
    SELECT 1
    FROM core.accion_firma af
    WHERE af.accion_id = ap.id
      AND af.estado = 'FIRMADO'
  )
  THEN 'BORRADOR'
  
  WHEN NOT EXISTS (
    SELECT 1
    FROM core.accion_firma af
    WHERE af.accion_id = ap.id
      AND af.estado = 'PENDIENTE'
  )
  THEN 'APROBADO'
  
  ELSE 'EN_FIRMA'
END
WHERE ap.id = $1;
      `,
      [accionId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Documento eliminado correctamente y estado actualizado"
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error eliminando firma:", error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}
export async function listarFirmasAccion(req, res) {
  const { accionId } = req.params;

  const q = `
    SELECT
      af.id,
      af.accion_id,
      af.orden,
      af.rol_firma,
      af.estado,
      af.firmado_en,
      af.observacion,
      af.cargo_id,
      c.nombre AS cargo_nombre,
      af.firmante_id,
      f.nombre AS firmante_nombre,
      af.documento_id,
      d.archivo_path AS documento_path,
      d.version AS documento_version,
      d.subido_por_firmante_id
    FROM core.accion_firma af
    JOIN core.cargo c ON c.id = af.cargo_id
    LEFT JOIN core.firmante f ON f.id = af.firmante_id
    LEFT JOIN core.accion_documento d ON d.id = af.documento_id
    WHERE af.accion_id = $1
    ORDER BY af.orden ASC;
  `;

  const r = await pool.query(q, [accionId]);
  return res.json({ count: r.rowCount, items: r.rows });
}

export async function firmaPendienteAccion(req, res) {
  const { accionId } = req.params;

  const q = `
    SELECT
      af.id,
      af.accion_id,
      af.orden,
      af.rol_firma,
      af.cargo_id,
      c.nombre AS cargo_nombre,
      af.estado
    FROM core.accion_firma af
    JOIN core.cargo c ON c.id = af.cargo_id
    WHERE af.accion_id = $1
      AND af.estado = 'PENDIENTE'
    ORDER BY af.orden ASC
    LIMIT 1;
  `;

  const r = await pool.query(q, [accionId]);

  if (!r.rows.length) {
    return res.json(null);
  }

  return res.json(r.rows[0]);
}


