-- Módulo de Auditoría (v1): registro de acciones sensibles del sistema,
-- visible solo para el rol Administrador del Sistema (es_admin). Cubre las
-- 3 áreas que más generan reclamos cuando algo sale mal: saldos (asignar/
-- corregir), vacaciones (aprobación en cada etapa / negación) y permisos
-- (aprobación/rechazo). No se denormaliza el nombre de quién actuó ni del
-- servidor afectado: se guardan los id (firmante_id, servidor_afectado_id)
-- y la pantalla de auditoría hace el JOIN al consultar, para no quedar
-- desactualizado si el nombre de alguien cambia.
CREATE TABLE IF NOT EXISTS core.auditoria (
  id bigserial PRIMARY KEY,
  accion text NOT NULL,
  firmante_id uuid NOT NULL REFERENCES core.firmante(id),
  servidor_afectado_id uuid REFERENCES core.servidor(id),
  recurso_tipo text,
  recurso_id text,
  detalle jsonb,
  descripcion text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_auditoria_accion CHECK (accion IN (
    'SALDO_ASIGNADO',
    'SALDO_CORREGIDO',
    'VACACION_APROBADA_JEFE',
    'VACACION_APROBADA_SUPERIOR',
    'VACACION_APROBADA_UATH',
    'VACACION_NEGADA',
    'PERMISO_APROBADO',
    'PERMISO_RECHAZADO'
  ))
);

CREATE INDEX IF NOT EXISTS idx_auditoria_created_at ON core.auditoria (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_firmante ON core.auditoria (firmante_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_servidor_afectado ON core.auditoria (servidor_afectado_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_accion ON core.auditoria (accion);
