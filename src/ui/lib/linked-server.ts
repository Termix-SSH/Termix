import { isElectron } from "@/lib/electron";
import { authApi } from "@/main-axios";
import { SYNC_CHANGED_EVENT } from "@/lib/sync-events";

export { SYNC_CHANGED_EVENT };

/** The server this desktop is linked to, and the session it syncs with. */
export interface LinkedSession {
  serverUrl: string;
  token: string;
}

const CACHE_MS = 60_000;
let cached: { at: number; value: LinkedSession | null } | null = null;
let inflight: Promise<LinkedSession | null> | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(SYNC_CHANGED_EVENT, () => {
    cached = null;
  });
}

/** Null on the web, or when this desktop is not linked or signed out. */
export async function getLinkedSession(): Promise<LinkedSession | null> {
  if (!isElectron()) return null;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (!inflight) {
    inflight = authApi
      .get("/sync/link/session")
      .then((response) => {
        const { serverUrl, token } = response.data ?? {};
        const value =
          typeof serverUrl === "string" && typeof token === "string"
            ? { serverUrl: serverUrl.replace(/\/$/, ""), token }
            : null;
        cached = { at: Date.now(), value };
        return value;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function notifySyncChanged(): void {
  cached = null;
  window.dispatchEvent(new CustomEvent(SYNC_CHANGED_EVENT));
}
