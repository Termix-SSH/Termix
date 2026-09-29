export function parseProxmoxJumpHosts(raw: unknown): unknown[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
