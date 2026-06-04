import { CARGO_IDS } from "../constants/cargos.js";

const connections = new Map();

export function addConnection(cargoId, res) {
  if (!connections.has(cargoId)) {
    connections.set(cargoId, []);
  }
  connections.get(cargoId).push(res);
}

export function removeConnection(cargoId, res) {
  if (!connections.has(cargoId)) return;
  const filtered = connections.get(cargoId).filter((r) => r !== res);
  connections.set(cargoId, filtered);
}

export function notifyCargoId(cargoId, data) {
  const cargoIds = new Set([cargoId]);

  if (cargoId === CARGO_IDS.ASISTENTE_UATH) {
    cargoIds.add(CARGO_IDS.AUXILIAR_UATH);
  }

  if (cargoId === `firma-${CARGO_IDS.ASISTENTE_UATH}`) {
    cargoIds.add(`firma-${CARGO_IDS.AUXILIAR_UATH}`);
  }

  cargoIds.forEach((id) => {
    const clients = connections.get(id) || [];
    clients.forEach((res) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
  });
}
