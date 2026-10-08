-- Agrega el estado activo/inactivo a las unidades orgánicas. Por defecto
-- TRUE para que todas las unidades existentes sigan visibles tal como
-- están ahora — nada se oculta solo por correr esta migración.
ALTER TABLE core.unidad_organica
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
