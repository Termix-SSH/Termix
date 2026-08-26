import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { systemLogger } from "./logger.js";

/**
 * Reverse-proxy hops whose `X-Forwarded-For` entries may be believed.
 *
 * Configured through `TRUSTED_PROXIES`, a comma-separated list of IPs, CIDRs
 * and/or the presets `loopback`, `linklocal`, `uniquelocal` - the same
 * vocabulary Express's `trust proxy` accepts, so the exact same string drives
 * both `req.ip` and the WebSocket upgrade path (which never goes through
 * Express and has to resolve the client address itself).
 *
 * The default is `loopback`, which is what the bundled nginx connects from.
 * nginx appends the address it saw to `X-Forwarded-For`, so the rightmost
 * untrusted entry is the real client and nothing a client sends can move it:
 * `X-Forwarded-For: 1.2.3.4` arrives as `1.2.3.4, <real client>` and the
 * spoofed entry is simply never reached.
 *
 * Set it to `true` to trust every hop (the pre-hardening behavior - only safe
 * when nothing untrusted can reach the backend) or to `false`/`none` to
 * believe no forwarded header at all.
 */
const PRESETS: Record<string, ReadonlyArray<readonly [string, number]>> = {
  loopback: [
    ["127.0.0.0", 8],
    ["::1", 128],
  ],
  linklocal: [
    ["169.254.0.0", 16],
    ["fe80::", 10],
  ],
  uniquelocal: [
    ["10.0.0.0", 8],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
    ["fc00::", 7],
  ],
};

export const DEFAULT_TRUSTED_PROXIES = "loopback";

export type TrustProxySetting = string | boolean;

/** Entries Express's proxy-addr accepts. Anything else makes `app.set` throw. */
function invalidEntries(setting: string): string[] {
  const invalid: string[] = [];
  for (const rawEntry of setting.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    if (PRESETS[entry.toLowerCase()]) continue;

    const [rawAddress, rawPrefix] = entry.split("/");
    const family = isIP(normalizeAddress(rawAddress));
    if (!family) {
      invalid.push(entry);
      continue;
    }
    if (rawPrefix === undefined) continue;
    const prefix = Number(rawPrefix);
    const max = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      invalid.push(entry);
    }
  }
  return invalid;
}

export function getTrustProxySetting(
  env: NodeJS.ProcessEnv = process.env,
): TrustProxySetting {
  const raw = env.TRUSTED_PROXIES?.trim();
  if (!raw) return DEFAULT_TRUSTED_PROXIES;

  const normalized = raw.toLowerCase();
  if (normalized === "true" || normalized === "all") return true;
  if (normalized === "false" || normalized === "none") return false;

  // Express compiles this value the moment it is set, and throws on anything
  // proxy-addr cannot parse - at module load, so a single typo would put the
  // backend into a crash loop behind an opaque "invalid IP address". Fall back
  // to the default instead, which is the restrictive value, and say why.
  const invalid = invalidEntries(raw);
  if (invalid.length > 0) {
    systemLogger.error(
      `Ignoring TRUSTED_PROXIES: ${invalid.join(", ")} is not an IP, CIDR or one of ${Object.keys(PRESETS).join("/")}. Falling back to "${DEFAULT_TRUSTED_PROXIES}".`,
      { operation: "trusted_proxies_invalid", invalid },
    );
    return DEFAULT_TRUSTED_PROXIES;
  }

  return raw;
}

function normalizeAddress(address: string): string {
  const withoutZone = address.split("%")[0].replace(/^\[|\]$/g, "");
  return withoutZone.startsWith("::ffff:")
    ? withoutZone.slice("::ffff:".length)
    : withoutZone;
}

function buildBlockList(setting: string): BlockList {
  const blockList = new BlockList();
  for (const rawEntry of setting.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const preset = PRESETS[entry.toLowerCase()];
    if (preset) {
      for (const [network, prefix] of preset) {
        blockList.addSubnet(
          network,
          prefix,
          isIP(network) === 4 ? "ipv4" : "ipv6",
        );
      }
      continue;
    }

    const [rawAddress, rawPrefix] = entry.split("/");
    const address = normalizeAddress(rawAddress);
    const family = isIP(address);
    if (!family) continue;
    const type = family === 4 ? "ipv4" : "ipv6";

    if (rawPrefix === undefined) {
      blockList.addAddress(address, type);
      continue;
    }
    const prefix = Number(rawPrefix);
    const max = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) continue;
    blockList.addSubnet(address, prefix, type);
  }
  return blockList;
}

const blockListCache = new Map<string, BlockList>();

export function isTrustedProxy(
  address: string | undefined,
  setting: TrustProxySetting = getTrustProxySetting(),
): boolean {
  if (setting === true) return true;
  if (setting === false || !address) return false;

  let blockList = blockListCache.get(setting);
  if (!blockList) {
    blockList = buildBlockList(setting);
    blockListCache.set(setting, blockList);
  }

  const normalized = normalizeAddress(address);
  const family = isIP(normalized);
  if (!family) return false;
  return blockList.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Walks `X-Forwarded-For` right to left, starting at the peer that actually
 * opened the socket, and stops at the first hop that is not a trusted proxy.
 * That hop is the closest address to the client this deployment can vouch for;
 * everything further left was written by someone we have no reason to believe.
 */
export function resolveClientIp(
  socketAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  setting: TrustProxySetting = getTrustProxySetting(),
): string {
  const peer = socketAddress ? normalizeAddress(socketAddress) : "";
  if (!isTrustedProxy(peer || undefined, setting)) return peer || "unknown";

  const header = Array.isArray(forwardedFor)
    ? forwardedFor.join(",")
    : forwardedFor || "";
  const hops = header
    .split(",")
    .map((hop) => normalizeAddress(hop.trim()))
    .filter(Boolean);

  for (let i = hops.length - 1; i >= 0; i -= 1) {
    if (!isTrustedProxy(hops[i], setting)) return hops[i];
  }

  return peer || "unknown";
}

export function resolveRequestClientIp(
  req: IncomingMessage,
  setting: TrustProxySetting = getTrustProxySetting(),
): string {
  return resolveClientIp(
    req.socket?.remoteAddress,
    req.headers["x-forwarded-for"],
    setting,
  );
}
