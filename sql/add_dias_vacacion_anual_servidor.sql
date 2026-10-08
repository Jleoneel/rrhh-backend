-- Override individual de días de vacación anuales para UN servidor
-- específico (ej. auxiliares de enfermería generan más días que el resto
-- de su misma unidad orgánica, así que la tasa por unidad no basta).
-- NULL = hereda la tasa de su unidad (unidad_organica.dias_vacacion_anual),
-- que a su vez cae a 30 si tampoco está configurada. Un valor no nulo aquí
-- tiene prioridad sobre ambos — ver COALESCE en acumularSaldos.job.js.
ALTER TABLE core.servidor
  ADD COLUMN IF NOT EXISTS dias_vacacion_anual integer NULL;
