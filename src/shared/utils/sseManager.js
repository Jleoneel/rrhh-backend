import { cargoIdsEquivalentes } from "../constants/cargos.js";

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
  const isFirmaKey = String(cargoId).startsWith("firma-");
  const cargoIdBase = isFirmaKey ? String(cargoId).replace("firma-", "") : cargoId;
  const cargoIds = new Set(
    cargoIdsEquivalentes(cargoIdBase).map((id) =>
      isFirmaKey ? `firma-${id}` : id,
    ),
  );

  cargoIds.forEach((id) => {
    const clients = connections.get(id) || [];
    clients.forEach((res) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
  });
}
