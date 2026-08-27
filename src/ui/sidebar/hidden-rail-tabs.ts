export function readHiddenRailTabs(): Set<string> {
  try {
    const raw = localStorage.getItem("hiddenRailTabs");
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}
