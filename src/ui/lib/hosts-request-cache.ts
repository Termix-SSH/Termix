import type { SSHHost } from "@/types/index";
import type { ServerStatus } from "@/main-axios";
import { createTtlRequestCache } from "./ttl-request-cache";

/** Host list changes less often than status; keep a short shared window. */
const HOSTS_TTL_MS = 10_000;
/** Status polls stack from many UI surfaces; short TTL + inflight dedupe. */
const STATUS_TTL_MS = 3_000;

const hostsCache = createTtlRequestCache<SSHHost[]>(HOSTS_TTL_MS);
const statusCache = createTtlRequestCache<Record<number, ServerStatus>>(
  STATUS_TTL_MS,
);

let listenersBound = false;

function bindInvalidationListeners(): void {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;

  const invalidateHosts = () => {
    hostsCache.invalidate();
  };

  window.addEventListener("ssh-hosts:changed", invalidateHosts);
  window.addEventListener("hosts:refresh", invalidateHosts);
}

export function getCachedSSHHosts(
  loader: () => Promise<SSHHost[]>,
): Promise<SSHHost[]> {
  bindInvalidationListeners();
  return hostsCache.get(loader);
}

export function getCachedServerStatuses(
  loader: () => Promise<Record<number, ServerStatus>>,
): Promise<Record<number, ServerStatus>> {
  return statusCache.get(loader);
}

export function invalidateSSHHostsCache(): void {
  hostsCache.invalidate();
}

export function invalidateServerStatusCache(): void {
  statusCache.invalidate();
}

/** Drop both caches after host mutations so the next read is fresh. */
export function invalidateHostsAndStatusCaches(): void {
  hostsCache.invalidate();
  statusCache.invalidate();
}
