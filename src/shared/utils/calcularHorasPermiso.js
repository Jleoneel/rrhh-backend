import { ALMUERZO_INICIO, ALMUERZO_FIN } from "../constants/horario.js";

// Calcula las horas efectivas de un permiso por horas, descontando el
// traslape con la ventana de almuerzo institucional del cálculo bruto
// (regreso - salida). Se separan bruto y neto para poder distinguir,
// en el llamador, un horario invertido (bruto <= 0) de un horario que
// cae completamente dentro del almuerzo (neto <= 0).
export function calcularHorasPermiso(hora_salida, hora_regreso) {
  const salida = new Date(`2000-01-01T${hora_salida}`);
  const regreso = new Date(`2000-01-01T${hora_regreso}`);
  const almuerzoInicio = new Date(`2000-01-01T${ALMUERZO_INICIO}`);
  const almuerzoFin = new Date(`2000-01-01T${ALMUERZO_FIN}`);

  const horasBrutas = (regreso - salida) / (1000 * 60 * 60);

  const traslapeInicio = new Date(Math.max(salida, almuerzoInicio));
  const traslapeFin = new Date(Math.min(regreso, almuerzoFin));
  const traslapeMs = Math.max(0, traslapeFin - traslapeInicio);
  const horasAlmuerzo = traslapeMs / (1000 * 60 * 60);

  return { horasBrutas, horasNetas: horasBrutas - horasAlmuerzo };
}
