-- Permite que una fila de core.notificacion_permiso apunte a un bloque del
-- Cronograma de Vacaciones (tipo = 'CRONOGRAMA_PROGRAMADA'), reutilizando la
-- misma tabla/infraestructura de notificaciones que ya usan permisos y
-- vacaciones en vez de crear un sistema paralelo.
ALTER TABLE core.notificacion_permiso
  ADD COLUMN IF NOT EXISTS cronograma_bloque_id uuid
    REFERENCES core.cronograma_vacaciones_bloque(id);
