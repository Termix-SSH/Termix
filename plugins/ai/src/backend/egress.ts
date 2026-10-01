import { BlockList, isIP } from "net";

/**
 * Where the assistant is allowed to send requests.
 *
 * Every provider request goes through ctx.fetch, which refuses private and
 * loopback addresses (after DNS, too) unless the exact host is listed. That
 * guard is exactly what a self-hosted Ollama on localhost trips over, so the
 * admin setting "privateEndpoints" names the hosts that may be private.
 * Without that split, any logged-in user could point a "provider" at an
 * internal service and use the backend as an authenticated probe of the
 * server's own network.
 *
 * The checks here only exist to give a useful message before the request is
 * made. ctx.fetch is the control.
 */

/** Hosts a self-hoster almost certainly wants, and which reach only this machine. */
export const DEFAULT_PRIVATE_ALLOWLIST = [
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
];

export const PRIVATE_DESTINATION_MESSAGE =
  "This address is on a private network. An administrator must add its host to the AI endpoint allowlist first.";

/** A bare host, not a URL: no scheme, path, port or whitespace. */
const HOST_PATTERN = /^[a-z0-9._:-]+$/;

/**
 * The admin setting is one host per line. Anything that is not a bare host
 * is ignored rather than failing the whole list.
 */
export function parseAllowlist(raw: unknown): string[] {
  if (typeof raw !== "string") return [...DEFAULT_PRIVATE_ALLOWLIST];
  const hosts: string[] = [];
  for (const line of raw.split(/[\r\n,]+/)) {
    const host = line.trim().toLowerCase();
    if (host && HOST_PATTERN.test(host) && !hosts.includes(host)) {
      hosts.push(host);
    }
  }
  return hosts;
}

const PRIVATE_RANGES = (() => {
  const list = new BlockList();
  list.addSubnet("0.0.0.0", 8, "ipv4");
  list.addSubnet("10.0.0.0", 8, "ipv4");
  list.addSubnet("100.64.0.0", 10, "ipv4");
  list.addSubnet("127.0.0.0", 8, "ipv4");
  list.addSubnet("169.254.0.0", 16, "ipv4");
  list.addSubnet("172.16.0.0", 12, "ipv4");
  list.addSubnet("192.168.0.0", 16, "ipv4");
  list.addAddress("::", "ipv6");
  list.addAddress("::1", "ipv6");
  list.addSubnet("fc00::", 7, "ipv6");
  list.addSubnet("fe80::", 10, "ipv6");
  return list;
})();

function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/**
 * True when the URL names a destination the outbound guard would refuse. A
 * bare hostname that is not an IP literal (e.g. "ollama.internal") counts as
 * private only if it is "localhost"; anything else needs DNS resolution,
 * which ctx.fetch does.
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
  const family = isIP(host);
  if (family === 4) return PRIVATE_RANGES.check(host, "ipv4");
  if (family === 6) return PRIVATE_RANGES.check(host, "ipv6");
  return false;
}

export interface EgressDecision {
  allowed: boolean;
  /** True when the destination is an allowlisted private host. */
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
  const normalized = allowlist.map((entry) => entry.trim().toLowerCase());

  // An allowlisted hostname may resolve to a private address; ctx.fetch
  // lets it through because the same list is passed as allowPrivateHosts.
  if (normalized.includes(host)) {
    return { allowed: true, isPrivate: true };
  }

  if (!isPrivateDestination(rawUrl)) return { allowed: true, isPrivate: false };

  return {
    allowed: false,
    isPrivate: true,
    reason: PRIVATE_DESTINATION_MESSAGE,
  };
}
