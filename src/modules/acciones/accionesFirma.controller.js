import path from "path";
import { withTransaction } from "../../db.js";
import { notifyCargoId } from "../../shared/utils/sseManager.js";

export async function subirFirmado(req, res) {
  const { accionId } = req.params;
  const { firmante_id, cargo_id } = req.user;

  if (!req.file) {
    return res
      .status(400)
      .json({ message: "Archivo PDF requerido (field: file)" });
  }

  const uploadsBase = path.resolve(process.env.UPLOADS_DIR || "uploads");
  const archivoAbs = req.file.path;
  const rel = path.relative(uploadsBase, archivoAbs).replaceAll("\\", "/");
  const archivoPath = `/uploads/${rel}`;

  try {
    const out = await withTransaction(async (client) => {
      await client.query(
        `SELECT id FROM core.accion_personal WHERE id = $1 FOR UPDATE`,
        [accionId],
      );

      // 1) Obtener firma pendiente actual (la siguiente)
      const pendR = await client.query(
        `
        SELECT id, orden, rol_firma, cargo_id
        FROM core.accion_firma
        WHERE accion_id = $1 AND estado = 'PENDIENTE'
        ORDER BY orden ASC
        LIMIT 1;
        `,
        [accionId],
      );
      const firmaPend = pendR.rows[0];

      if (!firmaPend) {
        return {
          status: 409,
          body: { message: "No hay firmas pendientes. Acción finalizada." },
        };
      }

      // 2) Validar cargo
      if (firmaPend.cargo_id !== cargo_id) {
        return {
          status: 403,
          body: {
            message: "No autorizado para firmar este paso",
            orden_pendiente: firmaPend.orden,
            cargo_requerido: firmaPend.cargo_id,
            tu_cargo: cargo_id,
          },
        };
      }

      // 3) ¿Es la última firma? -> FINAL
      const maxR = await client.query(
        `SELECT MAX(orden)::int AS max_orden FROM core.accion_firma WHERE accion_id = $1;`,
        [accionId],
      );
      const maxOrden = maxR.rows[0].max_orden;

      const esUltimaFirma = Number(firmaPend.orden) === Number(maxOrden);
      const tipoDoc = esUltimaFirma ? "FINAL" : "FIRMADO_PARCIAL";

      // 4) Version incremental
      const verR = await client.query(
        `SELECT COALESCE(MAX(version),0)+1 AS next FROM core.accion_documento WHERE accion_id=$1;`,
        [accionId],
      );
      const version = verR.rows[0].next;

      // 5) Si será FINAL, reemplaza final anterior para no duplicar
      if (esUltimaFirma) {
        await client.query(
          `UPDATE core.accion_documento
           SET tipo = 'FINAL_REEMPLAZADO'
           WHERE accion_id = $1 AND tipo = 'FINAL';`,
          [accionId],
        );
      }

      // 6) Insertar documento
      const docR = await client.query(
        `
        INSERT INTO core.accion_documento
          (accion_id, version, tipo, archivo_path, subido_en, subido_por_firmante_id)
        VALUES
          ($1, $2, $3, $4, NOW(), $5)
        RETURNING id, tipo;
        `,
        [accionId, version, tipoDoc, archivoPath, firmante_id],
      );

      const documento_id = docR.rows[0].id;
      const documento_tipo = docR.rows[0].tipo;

      // 7) Marcar firma como firmada
      const updR = await client.query(
        `
        UPDATE core.accion_firma
        SET estado='FIRMADO', firmado_en=NOW(), firmante_id=$2, documento_id=$3
        WHERE id=$1
        RETURNING id, orden, rol_firma, estado;
        `,
        [firmaPend.id, firmante_id, documento_id],
      );

      // 8) Si es primera firma: EN_FIRMA
      const countR = await client.query(
        `
        SELECT SUM(CASE WHEN estado = 'FIRMADO' THEN 1 ELSE 0 END)::int AS firmadas
        FROM core.accion_firma
        WHERE accion_id = $1;
        `,
        [accionId],
      );
      const firmadas = Number(countR.rows[0].firmadas || 0);
      const esPrimeraFirma = firmadas === 1;

      if (esPrimeraFirma) {
        await client.query(
          `UPDATE core.accion_personal SET estado = 'EN_FIRMA'
           WHERE id = $1 AND estado = 'BORRADOR';`,
          [accionId],
        );
      }

      // 9) Si no quedan pendientes: APROBADO
      const restR = await client.query(
        `SELECT COUNT(*)::int AS n
         FROM core.accion_firma
         WHERE accion_id=$1 AND estado='PENDIENTE';`,
        [accionId],
      );
      const restantes = Number(restR.rows[0].n || 0);

      if (restantes === 0) {
        await client.query(
          `UPDATE core.accion_personal SET estado='APROBADO' WHERE id=$1;`,
          [accionId],
        );
      }
      // 🔔 Notificar al siguiente firmante si quedan pendientes
      if (restantes > 0) {
        const siguienteR = await client.query(
          `SELECT cargo_id, rol_firma, orden
     FROM core.accion_firma
     WHERE accion_id = $1 AND estado = 'PENDIENTE'
     ORDER BY orden ASC LIMIT 1;`,
          [accionId],
        );

        if (siguienteR.rows.length) {
          const siguiente = siguienteR.rows[0];

          // Guardar en BD (para cuando no esté conectado)
          await client.query(
            `INSERT INTO core.notificacion_firma
         (cargo_id, accion_id, rol_firma, orden)
       VALUES ($1, $2, $3, $4);`,
            [
              siguiente.cargo_id,
              accionId,
              siguiente.rol_firma,
              siguiente.orden,
            ],
          );

          // Emitir SSE si está conectado
          notifyCargoId(siguiente.cargo_id, {
            tipo: "FIRMA_PENDIENTE",
            accion_id: accionId,
            rol_firma: siguiente.rol_firma,
            orden: siguiente.orden,
            mensaje: `Tienes una firma pendiente: ${siguiente.rol_firma}`,
          });
        }
      }

      return {
        status: 200,
        body: {
          message: "Firma registrada correctamente",
          accion_id: accionId,
          firmado: updR.rows[0],
          documento: {
            id: documento_id,
            version,
            tipo: documento_tipo,
            archivo_path: archivoPath,
          },
          restantes_pendientes: restantes,
          accion_finalizada: restantes === 0,
        },
      };
    });

    return res.status(out.status).json(out.body);
  } catch (err) {
    return res.status(500).json({
      message: "Error registrando firma",
      error: err.message,
    });
  }
}
