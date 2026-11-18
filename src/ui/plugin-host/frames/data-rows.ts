/**
 * The rows a framed plugin's data hooks should run for right now. A data slot
 * on screen adds its row here; the plugin's background frame gets its own
 * rows only, runs its hook once per row and sends the values back as one
 * table (frame-values.ts). Rows that leave the screen stop their hook, so a
 * plugin only polls for what is shown.
 */

/** valueKey -> rowKey -> context. */
export type DataRows = Record<string, Record<string, Record<string, unknown>>>;

interface Mount {
  pluginId: string;
  valueKey: string;
  rowKey: string;
  context: Record<string, unknown>;
}

const mounts = new Map<number, Mount>();
const snapshots = new Map<string, DataRows>();
const listeners = new Set<(pluginId: string) => void>();
let nextId = 1;

const MAX_CONTEXT = 4000;

/**
 * What crosses to the frame: plain JSON only. A host record is cut to its id,
 * and the frame reads the host from its own list, which already carries only
 * that plugin's settings.
 */
export function frameRowContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (key === "host" && value && typeof value === "object") {
      const id = (value as { id?: unknown }).id;
      if (id !== undefined && out.hostId === undefined) out.hostId = id;
      continue;
    }
    if (typeof value === "function" || value === undefined) continue;
    out[key] = value;
  }
  try {
    const json = JSON.stringify(out);
    if (json.length > MAX_CONTEXT) return {};
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rebuild(pluginId: string): void {
  const rows: DataRows = {};
  for (const mount of mounts.values()) {
    if (mount.pluginId !== pluginId) continue;
    (rows[mount.valueKey] ??= {})[mount.rowKey] = mount.context;
  }
  const before = snapshots.get(pluginId);
  if (before && JSON.stringify(before) === JSON.stringify(rows)) return;
  snapshots.set(pluginId, rows);
  for (const listener of [...listeners]) listener(pluginId);
}

/** Adds a row on screen. Returns its removal. */
export function addDataRow(
  pluginId: string,
  valueKey: string,
  rowKey: string,
  context: Record<string, unknown> | undefined,
): () => void {
  const id = nextId++;
  mounts.set(id, {
    pluginId,
    valueKey,
    rowKey,
    context: frameRowContext(context),
  });
  rebuild(pluginId);
  return () => {
    if (mounts.delete(id)) rebuild(pluginId);
  };
}

const EMPTY: DataRows = {};

export function dataRowsFor(pluginId: string): DataRows {
  return snapshots.get(pluginId) ?? EMPTY;
}

export function onDataRowsChange(
  listener: (pluginId: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function resetDataRows(): void {
  mounts.clear();
  snapshots.clear();
  listeners.clear();
}
