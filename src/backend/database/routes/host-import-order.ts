import { normalizeImportedHost } from "./host-normalizers.js";

export function prepareHostImports(input: Record<string, unknown>[]) {
  const hosts = input.map((value, index) => ({
    host: normalizeImportedHost(value),
    index,
    exportId: value.exportId ?? value.id,
  }));
  const byId = new Map<unknown, (typeof hosts)[number]>();
  for (const entry of hosts) {
    if (entry.exportId === undefined) continue;
    if (!Number.isSafeInteger(entry.exportId) || Number(entry.exportId) <= 0)
      throw new Error(`Host ${entry.index + 1}: invalid exportId`);
    if (byId.has(entry.exportId))
      throw new Error(`Duplicate exported host ID: ${entry.exportId}`);
    byId.set(entry.exportId, entry);
  }
  const ordered: typeof hosts = [];
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (entry: (typeof hosts)[number]) => {
    if (visited.has(entry.index)) return;
    if (visiting.has(entry.index))
      throw new Error("Jump-host dependency cycle in import");
    visiting.add(entry.index);
    const jumps = entry.host.jumpHosts ?? [];
    if (!Array.isArray(jumps))
      throw new Error(`Host ${entry.index + 1}: jumpHosts must be an array`);
    for (const jump of jumps) {
      const dependency = byId.get(jump?.hostId);
      if (!dependency)
        throw new Error(
          `Host ${entry.index + 1}: jump host ${jump?.hostId} is missing from the export. Re-export and include all jump hosts.`,
        );
      visit(dependency);
    }
    visiting.delete(entry.index);
    visited.add(entry.index);
    ordered.push(entry);
  };
  hosts.forEach(visit);
  return ordered;
}

export function remapImportedJumpHosts(
  jumps: unknown,
  importedIds: Map<unknown, number>,
) {
  if (!Array.isArray(jumps)) return null;
  return jumps.map((jump) => {
    const hostId = importedIds.get(jump.hostId);
    if (hostId === undefined)
      throw new Error(`Jump host ${jump.hostId} failed to import`);
    return { hostId };
  });
}
