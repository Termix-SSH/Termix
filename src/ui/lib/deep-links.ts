/**
 * termix:// links the desktop app was opened with. Core reads
 * termix://host/<id> itself; every link also goes to plugins that listen,
 * with replay for ones that start after it came.
 */

export interface DeepLink {
  url: string;
  /** "command-line": a --host shortcut on this computer. "os-scheme": any link. */
  source: "os-scheme" | "command-line";
}

type Listener = (link: DeepLink) => void;

const listeners = new Set<Listener>();
const recent: DeepLink[] = [];
const MAX_RECENT = 20;
let started = false;

function deliver(raw: unknown): void {
  const value = raw as { url?: unknown; source?: unknown } | null;
  const url = value?.url;
  if (typeof url !== "string" || !url.startsWith("termix:")) return;
  const link: DeepLink = {
    url,
    source: value?.source === "command-line" ? "command-line" : "os-scheme",
  };
  recent.push(link);
  if (recent.length > MAX_RECENT) recent.shift();
  for (const listener of [...listeners]) {
    try {
      listener(link);
    } catch (error) {
      console.error("[deep-links] a listener failed", error);
    }
  }
}

/** Starts listening to the desktop app once. A browser has no links. */
export function startDeepLinks(): void {
  if (started) return;
  const api = typeof window === "undefined" ? undefined : window.electronAPI;
  if (typeof api?.onDeepLink !== "function") return;
  started = true;
  void api
    .onDeepLink(deliver)
    .then((earlier) => {
      if (Array.isArray(earlier)) earlier.forEach(deliver);
    })
    .catch(() => {});
}

/**
 * Calls `listener` for every link, first with the ones that already came.
 * Returns a function that stops it.
 */
export function onDeepLink(listener: Listener): () => void {
  listeners.add(listener);
  for (const link of recent) listener(link);
  return () => listeners.delete(listener);
}

/** The saved host id in termix://host/<id>, or null. */
export function hostIdOf(url: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "termix:") return null;
  const parts = `${parsed.host}${parsed.pathname}`.split("/").filter(Boolean);
  if (parts[0] !== "host" || parts.length !== 2) return null;
  const id = Number(parts[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Test seam. */
export function resetDeepLinks(): void {
  listeners.clear();
  recent.length = 0;
  started = false;
}
