// Sort writes per destination: response order is lost when both sides are merged.
//
// Keyed on the self-reference field the rows actually carry rather than on the
// entity name, so an entity a plugin adds gets the same treatment without this
// process needing the server's entity registry.
const SELF_REFERENCE_FIELDS = { hosts: "parentHostSyncId" };

function selfReferenceField(entityType, writes) {
  const known = SELF_REFERENCE_FIELDS[entityType];
  if (known) return known;
  // A plugin entity declares its own; detect it from the payload.
  const sample = writes.find((write) => write && write.row);
  if (!sample) return null;
  const candidate = Object.keys(sample.row).find(
    (key) => key === `parent${entityType}SyncId`,
  );
  return candidate || null;
}

function orderSyncWrites(entityType, writes) {
  const field = selfReferenceField(entityType, writes);
  if (!field) return writes;

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
    const parent = destinations.get(write.baseUrl).get(write.row[field]);
    if (parent) visit(parent);
    visiting.delete(write);
    visited.add(write);
    ordered.push(write);
  };
  writes.forEach(visit);
  return ordered;
}

module.exports = { orderSyncWrites };
