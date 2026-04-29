const CLIENT_CACHE_VERSION_KEY = "termix_client_cache_version";
const CURRENT_CLIENT_VERSION = import.meta.env.VITE_APP_VERSION || "0.0.0";

async function clearCacheStorage(): Promise<void> {
  if (!("caches" in window)) return;

  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((name) => caches.delete(name)));
}

async function clearServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
}

function storeCurrentVersion(): void {
  try {
    localStorage.setItem(CLIENT_CACHE_VERSION_KEY, CURRENT_CLIENT_VERSION);
  } catch {
    // expected - storage can be unavailable in restricted contexts
  }
}

export async function prepareClientCacheVersion(): Promise<void> {
  if (typeof window === "undefined") return;

  let storedVersion: string | null = null;
  try {
    storedVersion = localStorage.getItem(CLIENT_CACHE_VERSION_KEY);
  } catch {
    storedVersion = null;
  }

  if (storedVersion === CURRENT_CLIENT_VERSION) {
    return;
  }

  await Promise.allSettled([clearCacheStorage(), clearServiceWorkers()]);

  storeCurrentVersion();
}
