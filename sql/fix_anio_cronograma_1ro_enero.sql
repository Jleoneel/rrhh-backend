-- Corrige bloques del Cronograma de Vacaciones guardados con el año
-- anterior al real: el backend calculaba el año con
-- new Date(fecha_desde).getFullYear(), que parsea la fecha como UTC
-- medianoche y la lee de vuelta en la hora LOCAL del servidor. En
-- America/Guayaquil (UTC-5) eso corre un bloque que empieza el 1 de enero
-- al 31 de diciembre 19:00 del año anterior, así que quedaba guardado con
-- anio = año - 1. Esto solo afecta bloques cuyo fecha_desde es 1 de enero.
UPDATE core.cronograma_vacaciones_bloque
SET anio = EXTRACT(YEAR FROM fecha_desde)::int
WHERE anio <> EXTRACT(YEAR FROM fecha_desde)::int;
