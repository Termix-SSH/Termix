export function fontSizeStorageKey(identity: unknown): string | null {
  return typeof identity === "string" || typeof identity === "number"
    ? `terminal_fontsize_host_${identity}`
    : null;
}

export function readFontSize(
  storage: Storage,
  key: string | null,
  configured: number,
): number | null {
  if (!key) return null;
  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    if (
      value?.configured === configured &&
      Number.isFinite(value.size) &&
      value.size > 0
    )
      return value.size;
    storage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
  return null;
}

export function saveFontSize(
  storage: Storage,
  key: string | null,
  configured: number,
  size: number,
): void {
  if (!key) return;
  try {
    storage.setItem(key, JSON.stringify({ configured, size }));
  } catch {
    /* Storage may be unavailable. */
  }
}
