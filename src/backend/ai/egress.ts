import { isIP } from "net";
import { isBlockedAddress } from "../utils/safe-outbound-fetch.js";
import { createCurrentSettingsRepository } from "../database/repositories/factory.js";

/**
 * Where the assistant is allowed to send requests.
 *
 * Cloud providers are reached through the SSRF-guarded path, which refuses to
 * resolve to a private address. That guard is exactly what a self-hosted Ollama
 * on localhost trips over, so private destinations are permitted only when an
 * admin has named the host. Without that split, any logged-in user could point
 * a "provider" at an internal service and use the backend as an authenticated
 * probe of the server's own network.
 */

export const AI_PRIVATE_ALLOWLIST_KEY = "ai_private_endpoint_allowlist";

/** Hosts a self-hoster almost certainly wants, and which reach only this machine. */
export const DEFAULT_PRIVATE_ALLOWLIST = [
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
];

export function parseAllowlist(raw: string | null): string[] {
  if (!raw) return [...DEFAULT_PRIVATE_ALLOWLIST];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_PRIVATE_ALLOWLIST];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [...DEFAULT_PRIVATE_ALLOWLIST];
  }
}

export async function readPrivateAllowlist(): Promise<string[]> {
  const raw = await createCurrentSettingsRepository().get(
    AI_PRIVATE_ALLOWLIST_KEY,
  );
  return parseAllowlist(raw);
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/**
 * True when the URL names a destination the SSRF guard would refuse. A bare
 * hostname that is not an IP literal (e.g. "ollama.internal") is treated as
 * private only if it is "localhost" -- anything else resolves through DNS and
 * is caught at connect time by the guard instead.
 */
export function isPrivateDestination(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = normalizeHost(url.hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIP(host)) return isBlockedAddress(host);
  return false;
}

export interface EgressDecision {
  allowed: boolean;
  /** True when the destination needs the allowlisted-private path. */
  isPrivate: boolean;
  reason?: string;
}

export function evaluateEgress(
  rawUrl: string,
  allowlist: string[],
): EgressDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, isPrivate: false, reason: "Invalid URL" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { allowed: false, isPrivate: false, reason: "Unsupported protocol" };
  }
  if (url.username || url.password) {
    return {
      allowed: false,
      isPrivate: false,
      reason: "Credentials in URL are not allowed",
    };
  }

  const host = normalizeHost(url.hostname);
  const isPrivate = isPrivateDestination(rawUrl);

  if (!isPrivate) return { allowed: true, isPrivate: false };

  const normalized = allowlist.map((entry) => entry.trim().toLowerCase());
  if (normalized.includes(host)) return { allowed: true, isPrivate: true };

  return {
    allowed: false,
    isPrivate: true,
    reason:
      "This address is on a private network. An administrator must add its host to the AI endpoint allowlist first.",
  };
}
