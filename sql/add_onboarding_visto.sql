-- Recuerda qué versión de cada "tour" de bienvenida (modales tipo carrusel
-- explicando funcionalidades nuevas) ya vio cada usuario. Va en base de
-- datos y no en localStorage porque en el hospital varias personas usan la
-- misma estación de trabajo por turno, y localStorage quedaría atado a ese
-- navegador/PC, no a la persona.
CREATE TABLE IF NOT EXISTS core.onboarding_visto (
  id serial PRIMARY KEY,
  tipo_usuario text NOT NULL CHECK (tipo_usuario IN ('FIRMANTE', 'SERVIDOR')),
  usuario_id uuid NOT NULL,
  modulo text NOT NULL,
  version integer NOT NULL,
  visto_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo_usuario, usuario_id, modulo)
);
