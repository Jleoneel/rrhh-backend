import path from "path";
import { withTransaction } from "../db.js";

export async function subirFirmado(req, res) {
  const { accionId } = req.params;
  const { firmante_id, cargo_id } = req.user;

  if (!req.file) {
    return res
      .status(400)
      .json({ message: "Archivo PDF requerido (field: file)" });
  }

  // construir ruta pública /uploads/...
  const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
  const archivoAbs = req.file.path;
  const rel = path.relative(uploadsBase, archivoAbs).replaceAll("\\", "/");
  const archivoPath = `/uploads/${rel}`;

  try {
    const out = await withTransaction(async (client) => {
      // 1) obtener firma pendiente actual (menor orden)
      const pendQ = `
        SELECT id, orden, rol_firma, cargo_id
        FROM core.accion_firma
        WHERE accion_id = $1 AND estado = 'PENDIENTE'
        ORDER BY orden ASC
        LIMIT 1;
      `;
      const pendR = await client.query(pendQ, [accionId]);

      if (pendR.rowCount === 0) {
        return {
          status: 200,
          body: {
            message: "No hay firmas pendientes (posiblemente finalizada)",
          },
        };
      }

      const firmaPend = pendR.rows[0];

      // 2) validar cargo (seguridad)
      if (firmaPend.cargo_id !== cargo_id) {
        return {
          status: 403,
          body: {
            message: "No autorizado para firmar este paso",
            orden_pendiente: firmaPend.orden,
            rol_firma: firmaPend.rol_firma,
            cargo_requerido: firmaPend.cargo_id,
            tu_cargo: cargo_id,
          },
        };
      }

      // 3) crear documento (version incremental)
      const verR = await client.query(
        `SELECT COALESCE(MAX(version),0)+1 AS next FROM core.accion_documento WHERE accion_id=$1;`,
        [accionId],
      );
      const version = verR.rows[0].next;

      const insDocQ = `INSERT INTO core.accion_documento
            (accion_id, version, tipo, archivo_path, subido_en, subido_por_firmante_id)
          VALUES
          ($1, $2, 'FIRMADO_PARCIAL', $3, NOW(), $4)
            RETURNING id;`;
      const docR = await client.query(insDocQ, [
        accionId,
        version,
        archivoPath,
        firmante_id,
      ]);
      const documento_id = docR.rows[0].id;

      // 4) marcar firma como FIRMADO
      const updQ = `
        UPDATE core.accion_firma
        SET estado='FIRMADO', firmado_en=NOW(), firmante_id=$2, documento_id=$3
        WHERE id=$1
        RETURNING id, orden, rol_firma, estado;
      `;
      const updR = await client.query(updQ, [
        firmaPend.id,
        firmante_id,
        documento_id,
      ]);

      const countQ = `
        SELECT 
          COUNT(*) AS total_firmas,
          SUM(CASE WHEN estado = 'FIRMADO' THEN 1 ELSE 0 END) AS firmadas,
          MIN(orden) AS primer_orden
        FROM core.accion_firma
        WHERE accion_id = $1;
      `;
      const countR = await client.query(countQ, [accionId]);
      const { total_firmas, firmadas, primer_orden } = countR.rows[0];
      
      const esPrimeraFirma = parseInt(firmadas) === 1;

      // 5) SI ES LA PRIMERA FIRMA, CAMBIAR ESTADO DE BORRADOR A FIRMADO
      if (esPrimeraFirma) {
        await client.query(
          `UPDATE core.accion_personal 
           SET estado = 'EN_FIRMA'
           WHERE id = $1 AND estado = 'BORRADOR';`,
          [accionId]
        );
      }

      // 6) si ya no quedan pendientes -> finalizar accion_personal
      const restR = await client.query(
        `SELECT COUNT(*)::int AS n FROM core.accion_firma WHERE accion_id=$1 AND estado='PENDIENTE';`,
        [accionId],
      );
      const restantes = restR.rows[0].n;

      if (restantes === 0) {
        await client.query(
          `UPDATE core.accion_personal SET estado='APROBADO' WHERE id=$1;`,
          [accionId],
        );
      }

      return {
        status: 200,
        body: {
          message: "Firma registrada correctamente",
          accion_id: accionId,
          firmado: updR.rows[0],
          documento: { id: documento_id, version, archivo_path: archivoPath },
          restantes_pendientes: restantes,
          accion_finalizada: restantes === 0,
        },
      };
    });

    return res.status(out.status).json(out.body);
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Error registrando firma", error: err.message });
  }
}
