/**
 * The browser side of a report: where it runs, the window, storage key names
 * and the plugin frontends as this page sees them. Never storage values.
 */
import { describeEnvironment } from "@/lib/issue-url";
import { isElectron } from "@/lib/electron";
import { getPluginStoreState } from "@/plugin-host/plugin-store";
import { redactText } from "./redact";

function storageKeys(storage: Storage | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!storage) return out;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null) continue;
      out[key.slice(0, 80)] = storage.getItem(key)?.length ?? 0;
    }
  } catch {
    // Storage can be blocked.
  }
  return out;
}

async function serviceWorker(): Promise<Record<string, unknown>> {
  try {
    if (!("serviceWorker" in navigator)) return { supported: false };
    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      supported: true,
      controlled: !!navigator.serviceWorker.controller,
      registrations: registrations.length,
    };
  } catch {
    return { supported: true, error: "Could not be read" };
  }
}

export async function describePage(): Promise<Record<string, unknown>> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  };
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  return {
    environment: describeEnvironment(),
    desktop: isElectron(),
    userAgent: navigator.userAgent,
    language: navigator.language,
    languages: navigator.languages?.slice(0, 5),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
    clientTime: new Date().toISOString(),
    online: navigator.onLine,
    cookiesEnabled: navigator.cookieEnabled,
    connection: nav.connection?.effectiveType ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    cpus: navigator.hardwareConcurrency ?? null,
    window: {
      width: window.innerWidth,
      height: window.innerHeight,
      screen: `${screen.width}x${screen.height}`,
      pixelRatio: window.devicePixelRatio,
      colorScheme: window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
      reducedMotion:
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false,
    },
    page: {
      protocol: location.protocol,
      port: location.port || null,
      pathDepth: location.pathname.split("/").filter(Boolean).length,
      secure: window.isSecureContext,
      visible: document.visibilityState,
      loadedSecondsAgo: Math.round(performance.now() / 1000),
    },
    heapMb: memory
      ? {
          used: Math.round(memory.usedJSHeapSize / 1024 / 1024),
          limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024),
        }
      : null,
    serviceWorker: await serviceWorker(),
    localStorageKeys: storageKeys(window.localStorage),
    sessionStorageKeys: storageKeys(window.sessionStorage),
    frames: document.querySelectorAll("iframe").length,
  };
}

/** Each plugin's frontend as this page sees it. */
export function describeFrontends(): Array<Record<string, unknown>> {
  const { loaded, settled, records } = getPluginStoreState();
  const list = [...records.values()].map(({ summary, frontend, error }) => ({
    id: summary.id,
    version: summary.version,
    enabled: summary.enabled,
    state: summary.state,
    frontend,
    isolation: summary.frontendIsolation ?? null,
    hasBundle: !!summary.frontend,
    ...(error ? { error: redactText(error).slice(0, 1000) } : {}),
    ...(summary.lastError
      ? { serverError: redactText(summary.lastError).slice(0, 1000) }
      : {}),
  }));
  list.sort((a, b) => a.id.localeCompare(b.id));
  return [{ storeLoaded: loaded, settled }, ...list];
}
