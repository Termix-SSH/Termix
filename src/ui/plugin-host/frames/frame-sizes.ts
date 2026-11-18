/**
 * The size a view last reported, per view and host, so it opens at that
 * size instead of growing from nothing and pushing the page around.
 */

type Size = { width: number; height: number };

const lastSizes = new Map<string, Size>();
const MAX_SIZES = 500;

export function sizeKey(
  pluginId: string,
  frameKey: string,
  props: Record<string, unknown>,
): string {
  const host = props.host as { id?: unknown } | undefined;
  const hostId = props.hostId ?? host?.id ?? "";
  return `${pluginId}\u0000${frameKey}\u0000${String(hostId)}`;
}

export function lastSize(key: string): Size | null {
  return lastSizes.get(key) ?? null;
}

export function rememberSize(key: string, size: Size): void {
  lastSizes.delete(key);
  lastSizes.set(key, size);
  if (lastSizes.size > MAX_SIZES) {
    const oldest = lastSizes.keys().next().value;
    if (oldest !== undefined) lastSizes.delete(oldest);
  }
}

/** Test seam. */
export function resetFrameSizes(): void {
  lastSizes.clear();
}
