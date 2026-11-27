// Inserta un registro de auditoría. Recibe el `client` de la transacción
// activa (no el pool) a propósito: la auditoría debe quedar en el MISMO
// commit que la acción que audita — si la transacción hace rollback, el
// registro de auditoría tampoco debe quedar (nunca "se aprobó pero no
// quedó auditado", ni al revés).
export async function registrarAuditoria(client, {
  accion,
  firmanteId,
  servidorAfectadoId = null,
  recursoTipo = null,
  recursoId = null,
  detalle = null,
  descripcion,
}) {
  await client.query(
    `INSERT INTO core.auditoria
      (accion, firmante_id, servidor_afectado_id, recurso_tipo, recurso_id, detalle, descripcion)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      accion,
      firmanteId,
      servidorAfectadoId,
      recursoTipo,
      recursoId != null ? String(recursoId) : null,
      detalle != null ? JSON.stringify(detalle) : null,
      descripcion,
    ],
  );
}
