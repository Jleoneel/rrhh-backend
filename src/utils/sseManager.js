// Mapa: cargo_id → array de respuestas SSE activas
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
  const clients = connections.get(cargoId) || [];
  clients.forEach((res) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}