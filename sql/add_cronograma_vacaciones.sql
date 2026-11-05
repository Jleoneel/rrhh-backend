-- Cronograma anual de vacaciones: planificación previa que cada jefe de
-- área llena para su personal (quién se va, cuándo), reemplaza el Excel
-- "CRONOGRAMA DE VACACIONES". Es independiente del módulo de solicitud de
-- vacaciones que ya existe (core.vacacion_solicitud) — no dispara ni
-- reemplaza ninguna solicitud formal, es solo planificación/registro.
--
-- Normalizado en bloques (no en 12 columnas de mes como el Excel): una
-- persona puede tener varios bloques en el mismo año, incluso en el mismo
-- mes. dias se guarda calculado (no solo derivado en query) para que quede
-- congelado el valor con el que se validó el tope de 30, sin depender de
-- recalcularlo después.
CREATE TABLE IF NOT EXISTS core.cronograma_vacaciones_bloque (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servidor_id uuid NOT NULL REFERENCES core.servidor(id),
  anio integer NOT NULL,
  fecha_desde date NOT NULL,
  fecha_hasta date NOT NULL,
  dias integer NOT NULL,
  created_by uuid REFERENCES core.firmante(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cronograma_fechas_validas CHECK (fecha_hasta >= fecha_desde),
  CONSTRAINT cronograma_dias_positivos CHECK (dias > 0)
);

CREATE INDEX IF NOT EXISTS idx_cronograma_servidor_anio
  ON core.cronograma_vacaciones_bloque (servidor_id, anio);
