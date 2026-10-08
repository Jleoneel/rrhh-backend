-- Permite dar de baja a un servidor (despedido/retirado del hospital) sin
-- borrar su historial. Independiente de core.servidor.estado_servidor
-- (que viene del distributivo oficial y se sobrescribe en cada
-- reimportación) e independiente de core.usuario_servidor.activo (que
-- solo existe para quienes tienen cuenta de acceso creada). Un servidor
-- inactivo: no puede iniciar sesión aunque tenga usuario_servidor activo,
-- y no se le pueden crear nuevas Acciones de Personal.
ALTER TABLE core.servidor
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
