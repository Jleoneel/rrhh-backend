-- Permite marcar, por unidad orgánica, que el paso del jefe superior se
-- salta TEMPORALMENTE en el flujo de aprobación de vacaciones (jefe
-- inmediato -> UATH directo), sin borrar jefe_superior_id -- que sigue
-- siendo el jefe superior reglamentario de esa unidad, listo para volver
-- a aplicar en cuanto se desmarque. Default false: ninguna unidad
-- existente cambia de comportamiento al desplegar esto.
ALTER TABLE core.unidad_organica
  ADD COLUMN IF NOT EXISTS omitir_jefe_superior boolean NOT NULL DEFAULT false;
