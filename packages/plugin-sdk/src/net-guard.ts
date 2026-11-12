/**
 * Target checks for plugins that open their own sockets (net, tls, dgram,
 * http.request) instead of going through ctx.fetch. The name is looked up
 * once, every answer is checked, and the caller connects to the checked
 * address, so a second lookup can't point somewhere else. Uses the same
 * ranges as core's outbound guard.
 */

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();

/** Private, loopback, link-local, CGNAT, multicast and reserved ranges. */
export const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export const PRIVATE_IPV6_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

for (const [network, prefix] of PRIVATE_IPV4_RANGES) {
  blocked.addSubnet(network, prefix, "ipv4");
  blocked.addSubnet(`::ffff:${network}`, prefix + 96, "ipv6");
}
for (const [network, prefix] of PRIVATE_IPV6_RANGES) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/** True for private and reserved addresses, and for anything not an IP. */
export function isPrivateAddress(address: string): boolean {
  const bare = String(address ?? "").replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  return family === 0 || blocked.check(bare, family === 4 ? "ipv4" : "ipv6");
}

export class TargetRefusedError extends Error {
  readonly code = "TARGET_REFUSED";
  constructor(message = "Private destinations are not allowed") {
    super(message);
    this.name = "TargetRefusedError";
  }
}

export interface TargetGuardOptions {
  /**
   * Exact host names or addresses that may resolve to private addresses.
   * Fill it from an admin setting or a saved device address, never from the
   * request that asks for the connection.
   */
  allowPrivateHosts?: readonly string[];
  /** For tests. Defaults to dns.lookup. */
  lookup?: typeof dnsLookup;
}

export interface ResolvedTarget {
  address: string;
  family: 4 | 6;
}

function bareHost(host: string): string {
  return String(host ?? "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
}

function allowsPrivate(host: string, options: TargetGuardOptions): boolean {
  const wanted = bareHost(host);
  return (options.allowPrivateHosts ?? []).some(
    (entry) => bareHost(entry) === wanted,
  );
}

function lookupAll(
  host: string,
  lookup: typeof dnsLookup,
): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(host, { all: true, order: "verbatim" }, (error, addresses) => {
      if (error) return reject(error);
      const list = Array.isArray(addresses) ? addresses : [];
      if (!list.length) return reject(new Error("No addresses for host"));
      resolve(list);
    });
  });
}

/**
 * Looks the host up once and returns the address to connect to. Refuses when
 * any answer is private, unless the host is listed in allowPrivateHosts.
 * Connect to `address`; for TLS pass the original name as `servername`.
 */
export async function resolveTarget(
  host: string,
  options: TargetGuardOptions = {},
): Promise<ResolvedTarget> {
  const bare = bareHost(host);
  if (!bare) throw new TargetRefusedError("Missing host");
  const allowed = allowsPrivate(bare, options);
  const literal = isIP(bare);
  if (literal) {
    if (!allowed && isPrivateAddress(bare)) throw new TargetRefusedError();
    return { address: bare, family: literal as 4 | 6 };
  }
  const answers = await lookupAll(bare, options.lookup ?? dnsLookup);
  if (!allowed && answers.some(({ address }) => isPrivateAddress(address))) {
    throw new TargetRefusedError();
  }
  const first = answers[0];
  const family = isIP(first.address);
  if (!family) throw new Error("Lookup returned an invalid address");
  return { address: first.address, family: family as 4 | 6 };
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A `lookup` for net, tls, http(s) and dgram options, for clients that resolve
 * names themselves. Node skips lookup for IP literals, so check those with
 * resolveTarget (or isPrivateAddress) before connecting.
 */
export function pinnedLookup(options: TargetGuardOptions = {}) {
  return function guardedLookup(
    host: string,
    lookupOptions: { all?: boolean } | number | undefined,
    callback: LookupCallback,
  ): void {
    const all =
      typeof lookupOptions === "object" && lookupOptions?.all === true;
    lookupAll(bareHost(host), options.lookup ?? dnsLookup).then(
      (answers) => {
        if (
          !allowsPrivate(host, options) &&
          answers.some(({ address }) => isPrivateAddress(address))
        ) {
          return callback(new TargetRefusedError(), "", 0);
        }
        if (all) return callback(null, answers);
        const first = answers[0];
        callback(null, first.address, first.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0),
    );
  };
}
