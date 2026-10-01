/**
 * Where a secret source (a self-hosted 1Password Connect server) may be
 * reached. Every request goes through ctx.fetch, which refuses private and
 * loopback addresses unless the exact host is listed here, admin-only and
 * install-wide.
 */

export const DEFAULT_PRIVATE_ALLOWLIST = [
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
];

/** The admin setting is one host per line. A line that is not a bare host is ignored. */
const HOST_PATTERN = /^[a-z0-9._:-]+$/;

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
