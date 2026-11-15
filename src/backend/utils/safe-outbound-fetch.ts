import { lookup, type LookupAddress, type LookupOptions } from "dns";
import { BlockList, isIP } from "net";
import { Agent, fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici-types";
import { getProxyAgent } from "./proxy-agent.js";

type DnsLookupFn = (
  hostname: string,
  options: LookupOptions,
  callback: DnsLookupCallback,
) => void;

type DnsLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[] | undefined,
  family?: number,
) => void;

type LookupHookCallback = (
  error: NodeJS.ErrnoException | Error | null,
  address?: string | LookupAddress[],
  family?: number,
) => void;

const blockedAddresses = new BlockList();

// Derived, not hand-duplicated: Node's BlockList matches addresses across
// families through their IPv4-mapped-IPv6 form regardless of which `type`
// you pass to check()/addSubnet() (see the addAddress('123.123.123.123') /
// check('::ffff:123.123.123.123') example on
// https://nodejs.org/api/net.html#class-netblocklist). So every IPv4 range
// below needs an "::ffff:<net>" mirror in the IPv6 list, or a spoofed
// literal like "::ffff:127.0.0.1" slips through unblocked. Generating the
// mirror from this list instead of maintaining two lists by hand means the
// two can't drift out of sync the way they did before.
const blockedIpv4Ranges = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
] as const;

for (const [network, prefix] of blockedIpv4Ranges) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
  blockedAddresses.addSubnet(`::ffff:${network}`, prefix + 96, "ipv6");
  // IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) forms.
  blockedAddresses.addSubnet(`::${network}`, prefix + 96, "ipv6");
  blockedAddresses.addSubnet(`64:ff9b::${network}`, prefix + 96, "ipv6");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["64:ff9b:1::", 48], // local-use NAT64
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

// Cloud instance metadata. Refused even for a host an admin or plugin
// allowed as private: nothing in Termix needs it, and it hands out the
// machine's cloud credentials.
const metadataAddresses = new BlockList();
for (const address of [
  "169.254.169.254", // AWS, Azure, Google, most others
  "169.254.170.2", // AWS ECS task metadata
  "169.254.170.23", // AWS EKS pod identity
  "100.100.100.200", // Alibaba
]) {
  metadataAddresses.addAddress(address, "ipv4");
  metadataAddresses.addAddress(`::ffff:${address}`, "ipv6");
  metadataAddresses.addAddress(`::${address}`, "ipv6");
  metadataAddresses.addAddress(`64:ff9b::${address}`, "ipv6");
}
for (const address of ["fd00:ec2::254", "fd00:ec2::23"]) {
  metadataAddresses.addAddress(address, "ipv6");
}

const METADATA_NAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

export function isMetadataAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family !== 0 &&
    metadataAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

const loopbackAddresses = new BlockList();
for (const [network, prefix] of [
  ["127.0.0.0", 8],
  ["0.0.0.0", 8],
] as const) {
  loopbackAddresses.addSubnet(network, prefix, "ipv4");
  loopbackAddresses.addSubnet(`::ffff:${network}`, prefix + 96, "ipv6");
  loopbackAddresses.addSubnet(`::${network}`, prefix + 96, "ipv6");
}
loopbackAddresses.addAddress("::1", "ipv6");
loopbackAddresses.addAddress("::", "ipv6");

/** This machine itself: loopback and the unspecified address. */
export function isLoopbackAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family !== 0 &&
    loopbackAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family === 0 ||
    blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

// Extracted so the blocklist decision can be tested directly against a
// fake DNS resolver, instead of only through a real fetch()/Agent call,
// the actual bug here lived entirely in this callback, several layers
// below where undici's own "fetch failed" wrapping would otherwise hide it.
export function createDnsLookupHook(
  dnsLookup: DnsLookupFn = lookup,
  allowPrivate = false,
  refuseAddress?: (address: string) => boolean,
) {
  return function lookupHook(
    host: string,
    lookupOptions: LookupOptions,
    callback: LookupHookCallback,
  ): void {
    const cleanHost = String(host ?? "").replace(/^[|]$/g, "");
    const lookupAll = lookupOptions.all === true;

    dnsLookup(
      cleanHost,
      { ...lookupOptions, all: true, verbatim: true },
      (error, addresses, family) => {
        if (error) {
          return callback(error, "", 0);
        }

        const addrs = Array.isArray(addresses)
          ? addresses
          : addresses != null
            ? [{ address: addresses, family: family ?? isIP(addresses) }]
            : undefined;

        if (addrs === undefined) {
          return callback(
            new Error("DNS lookup returned invalid address"),
            "",
            0,
          );
        }

        if (!addrs.length) {
          return callback(
            new Error("DNS resolution returned no addresses"),
            "",
            0,
          );
        }

        if (
          refuseAddress &&
          addrs.some(({ address }) => refuseAddress(address))
        ) {
          return callback(new Error("This destination is not allowed"), "", 0);
        }

        if (addrs.some(({ address }) => isMetadataAddress(address))) {
          return callback(
            new Error("Cloud metadata addresses are not allowed"),
            "",
            0,
          );
        }

        if (
          !allowPrivate &&
          addrs.some(({ address }) => isBlockedAddress(address))
        ) {
          return callback(
            new Error("Private destinations are not allowed"),
            "",
            0,
          );
        }

        if (lookupAll) {
          return callback(null, addrs, 0);
        }

        const result = addrs[0];
        const addr = String(result.address ?? "").replace(/^\[|\]$/g, "");
        const fam =
          typeof result.family === "number" ? result.family : isIP(addr);

        if (!addr || isIP(addr) === 0) {
          return callback(
            new Error("DNS lookup returned invalid address"),
            "",
            0,
          );
        }

        return callback(null, addr, fam);
      },
    );
  };
}

export interface OutboundTlsOptions {
  /** PEM bundle to trust instead of the system store (private CAs). */
  ca?: string;
  /**
   * Skip certificate verification. Only for the one request that fetches a
   * private CA's root by fingerprint, where the caller verifies the result.
   */
  rejectUnauthorized?: boolean;
}

export async function readResponseTextLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Response exceeds ${maxBytes} bytes`);
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks, total).toString("utf8");
}

/** undici's own default for both, kept as the floor. */
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

export function outboundIdleTimeout(timeoutMs?: number): number {
  return Math.max(timeoutMs ?? 0, DEFAULT_IDLE_TIMEOUT_MS);
}

export async function safeOutboundFetch(
  rawUrl: string,
  options: RequestInit,
  allowedPrivateHosts: readonly string[] = [],
  tls: OutboundTlsOptions = {},
  idleTimeoutMs?: number,
  /** Addresses refused even for an allowed private host, checked at connect. */
  refuseAddress?: (address: string) => boolean,
): Promise<Response> {
  const url = new URL(rawUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Invalid outbound URL");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const allowPrivate = allowedPrivateHosts.some(
    (host) => host.trim().toLowerCase() === hostname.toLowerCase(),
  );
  // A proxy resolves the name itself, so the names are refused here too.
  if (
    isMetadataAddress(hostname) ||
    METADATA_NAMES.has(hostname.toLowerCase().replace(/\.$/, ""))
  ) {
    throw new Error("Cloud metadata addresses are not allowed");
  }
  if (!allowPrivate && isIP(hostname) && isBlockedAddress(hostname)) {
    throw new Error("Private destinations are not allowed");
  }
  if (refuseAddress && isIP(hostname) && refuseAddress(hostname)) {
    throw new Error("This destination is not allowed");
  }

  // An admin-allowlisted private host goes through the configured proxy,
  // when there is one, the same way core's own outbound calls do. A public
  // host never does: the proxy would resolve it, skipping the check above.
  // A proxy resolves names itself, so a caller with its own refusals skips it.
  const proxy =
    allowPrivate &&
    !refuseAddress &&
    !tls.ca &&
    tls.rejectUnauthorized !== false
      ? getProxyAgent(url.toString())
      : undefined;
  if (proxy) {
    return (await undiciFetch(url.toString(), {
      ...options,
      dispatcher: proxy as unknown as Dispatcher,
      redirect: options.redirect === "manual" ? "manual" : "error",
    } as never)) as unknown as Response;
  }

  // A slow model can go quiet for minutes mid-stream. Past bodyTimeout undici
  // kills the body with a bare "terminated".
  const idle = outboundIdleTimeout(idleTimeoutMs);
  const dispatcher = new Agent({
    headersTimeout: idle,
    bodyTimeout: idle,
    connect: {
      lookup: createDnsLookupHook(lookup, allowPrivate, refuseAddress),
      ...(tls.ca ? { ca: tls.ca } : {}),
      ...(tls.rejectUnauthorized === false
        ? { rejectUnauthorized: false }
        : {}),
    },
  });

  try {
    const response = await undiciFetch(url.toString(), {
      ...options,
      dispatcher,
      redirect: options.redirect === "manual" ? "manual" : "error",
    });
    // close() waits for the body, which the caller reads after we return.
    dispatcher.close().catch(() => {});
    return response;
  } catch (error) {
    await dispatcher.destroy().catch(() => {});
    throw error;
  }
}
