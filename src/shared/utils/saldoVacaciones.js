// El descuento de horas por una vacación ocurre en UN SOLO punto del
// sistema: cuando el jefe inmediato aprueba y firma
// (confirmar-firma-jefe en vac-firmas.routes.js). A partir de ahí la
// solicitud sigue su curso (gerente, UATH), y ninguno de esos pasos
// vuelve a tocar el saldo — ni cuando se APRUEBA después (correcto, ya
// se descontó una vez), ni cuando se NIEGA o se CANCELA en una etapa
// posterior, dejando el saldo descontado sin que la vacación se vaya a
// realizar. Antes esto se corregía a mano por base de datos.
//
// Esta función es la transacción COMPENSATORIA (no un ROLLBACK — la
// aprobación del jefe ya hizo COMMIT en una petición HTTP completamente
// distinta, no hay nada que deshacer de ahí): reingresa exactamente las
// mismas horas que se descontaron, dentro de la MISMA transacción que
// marca la solicitud como NEGADO o la cancela, para que ambas cosas
// sucedan juntas de forma atómica.
//
// Se usa `fecha_respuesta_jefe IS NOT NULL` como señal de "ya se
// descontó" — es como el propio confirmar-firma-jefe decide cuándo
// aprobó, así que es la misma fuente de verdad que el descuento
// original, no una suposición aparte.
export async function reingresarSaldoSiYaDescontado(
  client,
  solicitud,
  { creadoPor = null, descripcion },
) {
  if (!solicitud.fecha_respuesta_jefe) return false; // el jefe nunca aprobó: nunca se descontó nada

  const horas = parseFloat(solicitud.dias_solicitados) * 8;

  await client.query(
    `UPDATE core.saldo_permiso
     SET horas_usadas = GREATEST(horas_usadas - $1, 0), updated_at = NOW()
     WHERE servidor_id = $2`,
    [horas, solicitud.servidor_id],
  );

  // 'AJUSTE' porque chk_movimiento_tipo en core.permiso_movimiento solo
  // permite ('DESCUENTO', 'AJUSTE', 'INICIALIZACION') — no existe un
  // tipo "REINGRESO" a nivel de esquema.
  await client.query(
    `INSERT INTO core.permiso_movimiento (servidor_id, horas, tipo, descripcion, creado_por)
     VALUES ($1, $2, 'AJUSTE', $3, $4)`,
    [solicitud.servidor_id, -horas, descripcion, creadoPor],
  );

  return true;
}
