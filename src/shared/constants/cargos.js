export const CARGO_NOMBRES = {
  ASISTENTE_UATH: "ASISTENTE DE LA UATH",
  AUXILIAR_UATH: "AUXILIAR DE LA UATH",
};

export const CARGO_IDS = {
  ASISTENTE_UATH: "78de3b9c-a2f4-41ed-9823-bb72ee56d1f4",
  AUXILIAR_UATH: "5a7d49dd-926e-4eaa-8127-b05e9dae7e53",
};

const CARGOS_EQUIVALENTES = {
  [CARGO_IDS.ASISTENTE_UATH]: [
    CARGO_IDS.ASISTENTE_UATH,
    CARGO_IDS.AUXILIAR_UATH,
  ],
  [CARGO_IDS.AUXILIAR_UATH]: [
    CARGO_IDS.ASISTENTE_UATH,
    CARGO_IDS.AUXILIAR_UATH,
  ],
};

export function cargoIdsEquivalentes(cargoId) {
  return CARGOS_EQUIVALENTES[cargoId] || [cargoId];
}

export function cargoPuedeActuarComo(cargoActualId, cargoRequeridoId) {
  return cargoIdsEquivalentes(cargoRequeridoId).includes(cargoActualId);
}
