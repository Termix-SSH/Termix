/**
 * A frame has no storage of its own (opaque origin), so its localStorage is
 * kept here, under a prefix per plugin, with a size cap.
 */

const PREFIX = "termix-frame:";
const MAX_BYTES_PER_PLUGIN = 512 * 1024;

const prefixOf = (pluginId: string) => `${PREFIX}${pluginId}:`;

export function readFrameStorage(pluginId: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const prefix = prefixOf(pluginId);
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name?.startsWith(prefix)) continue;
      const value = localStorage.getItem(name);
      if (value !== null) out[name.slice(prefix.length)] = value;
    }
  } catch {
    // Private mode: frames start empty.
  }
  return out;
}

function usedBytes(pluginId: string, skip: string): number {
  let total = 0;
  for (const [name, value] of Object.entries(readFrameStorage(pluginId))) {
    if (name !== skip) total += name.length + value.length;
  }
  return total;
}

export function writeFrameStorage(
  pluginId: string,
  name: string,
  value: string | null,
): void {
  if (name.length > 200) return;
  try {
    const full = `${prefixOf(pluginId)}${name}`;
    if (value === null) {
      localStorage.removeItem(full);
      return;
    }
    if (
      usedBytes(pluginId, name) + name.length + value.length >
      MAX_BYTES_PER_PLUGIN
    ) {
      return;
    }
    localStorage.setItem(full, value);
  } catch {
    // Full or private mode; the frame keeps its copy for this session.
  }
}

/** Drops a plugin's stored values, when its data is deleted. */
export function clearFrameStorage(pluginId: string): void {
  try {
    for (const name of Object.keys(readFrameStorage(pluginId))) {
      localStorage.removeItem(`${prefixOf(pluginId)}${name}`);
    }
  } catch {
    // Nothing to clear.
  }
}
