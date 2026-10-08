-- Días de vacación que acumula anualmente cada unidad orgánica. Por
-- defecto 30 (el comportamiento actual: 20h/mes = 2.5 días/mes = 30/año),
-- así que ninguna unidad cambia de tasa hasta que se configure
-- explícitamente desde el botón de engranaje.
ALTER TABLE core.unidad_organica
  ADD COLUMN IF NOT EXISTS dias_vacacion_anual integer NOT NULL DEFAULT 30;
