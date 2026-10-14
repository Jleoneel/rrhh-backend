-- Fuerza el cambio de contraseña en el primer login: tanto la creación
-- masiva (crear-cuentas-masivo) como la individual dejan password = cédula,
-- y hasta ahora nada obligaba a cambiarla después. default true porque
-- toda cuenta nueva nace con password = cédula (ver usuarios-servidor.routes.js,
-- jefes.routes.js, firmantes.controller.js); se pone en false solo cuando
-- el propio usuario cambia su contraseña desde /auth/cambiar-password.
ALTER TABLE core.firmante
  ADD COLUMN IF NOT EXISTS debe_cambiar_password boolean NOT NULL DEFAULT true;

ALTER TABLE core.usuario_servidor
  ADD COLUMN IF NOT EXISTS debe_cambiar_password boolean NOT NULL DEFAULT true;
