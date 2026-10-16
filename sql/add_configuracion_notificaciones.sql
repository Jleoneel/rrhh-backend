-- Configuración global (una sola fila) para los destinatarios fijos de
-- notificación cuando se aprueba un permiso por horas o una vacación —
-- es una norma institucional, no depende de la unidad orgánica del
-- solicitante. Antes no existía ningún lugar para esto; cambiar al
-- destinatario requería tocar código. id fijo = 1 para garantizar que
-- nunca haya más de una fila (ver CHECK).
CREATE TABLE IF NOT EXISTS core.configuracion_notificaciones (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email_notificacion_permisos text NULL,
  email_notificacion_vacaciones text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO core.configuracion_notificaciones (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
