-- Revierte add_dias_vacacion_anual_unidad.sql: la configuración por
-- unidad orgánica quedó obsoleta — dentro de una misma unidad hay roles
-- con distinta tasa de vacación (ej. auxiliares de enfermería vs el
-- resto), así que la granularidad correcta es por servidor
-- (core.servidor.dias_vacacion_anual, ya en producción). Confirmado que
-- las 28 unidades siguen en el valor por defecto (30) antes de soltar
-- esta columna, así que no se pierde ninguna configuración real.
ALTER TABLE core.unidad_organica
  DROP COLUMN IF EXISTS dias_vacacion_anual;
