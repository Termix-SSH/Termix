import { safeOutboundFetch } from "../utils/safe-outbound-fetch.js";

/**
 * Outbound HTTP for automation steps and notification channels.
 *
 * safeOutboundFetch refuses private and loopback addresses, which is the right
 * default against SSRF but also blocks the self-hosted ntfy or Gotify sitting
 * on a LAN that many installs actually use. Rather than weaken the guard
 * globally, a destination can opt in explicitly; everything else about the
 * guard (scheme, embedded credentials, no redirects) still applies.
 */
export interface AutomationFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  allowPrivateNetwork?: boolean;
  timeoutMs?: number;
}

export async function automationFetch(
  url: string,
  options: AutomationFetchOptions = {},
): Promise<Response> {
  const {
    method = "GET",
    headers,
    body,
    allowPrivateNetwork,
    timeoutMs = 30_000,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 1));

  const init: RequestInit = {
    method,
    headers: body
      ? { "Content-Type": "application/json", ...(headers ?? {}) }
      : headers,
    body,
    signal: controller.signal,
  };

  try {
    if (allowPrivateNetwork) {
      return await privateNetworkFetch(url, init);
    }
    return await safeOutboundFetch(url, init);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The opt-in path. Keeps the parts of the guard that are always right and
 * drops only the address blocklist.
 */
async function privateNetworkFetch(
  rawUrl: string,
  init: RequestInit,
): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }

  return fetch(rawUrl, { ...init, redirect: "error" });
}
