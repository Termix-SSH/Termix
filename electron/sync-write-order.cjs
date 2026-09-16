// Sort writes per destination: response order is lost when both sides are merged.
function orderSyncWrites(entityType, writes) {
  if (entityType !== "hosts") return writes;
  const destinations = new Map();
  for (const write of writes) {
    if (!destinations.has(write.baseUrl)) {
      destinations.set(write.baseUrl, new Map());
    }
    destinations.get(write.baseUrl).set(write.row.syncId, write);
  }
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  const visit = (write) => {
    if (visited.has(write)) return;
    if (visiting.has(write))
      throw new Error("Cyclic parent host sync dependency");
    visiting.add(write);
    const parent = destinations
      .get(write.baseUrl)
      .get(write.row.parentHostSyncId);
    if (parent) visit(parent);
    visiting.delete(write);
    visited.add(write);
    ordered.push(write);
  };
  writes.forEach(visit);
  return ordered;
}

module.exports = { orderSyncWrites };
