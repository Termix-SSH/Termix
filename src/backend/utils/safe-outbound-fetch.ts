import { lookup } from "dns";
import { BlockList, isIP } from "net";
import { Agent } from "undici";

const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  // These mirror the IPv4 ranges above, just written as their
  // IPv4-mapped-IPv6 form (prefix = 96 + the IPv4 prefix), so that a
  // spoofed literal like "::ffff:127.0.0.1" gets caught too. We list
  // them individually instead of one "::ffff:0:0/96" catch-all because
  // Node's BlockList matches across families through this mapped form
  // regardless of which `type` you pass to check() — see the
  // addAddress('123.123.123.123') / check('::ffff:123.123.123.123')
  // example on https://nodejs.org/api/net.html#class-netblocklist for
  // the same thing from the other direction. A blanket ::ffff:0:0/96
  // covers the entire IPv4 space in mapped form, so it silently blocks
  // every plain IPv4 address too, not just spoofed ones.
  ["::ffff:0.0.0.0", 104], // 0.0.0.0/8
  ["::ffff:10.0.0.0", 104], // 10.0.0.0/8
  ["::ffff:100.64.0.0", 106], // 100.64.0.0/10 (CGNAT)
  ["::ffff:127.0.0.0", 104], // 127.0.0.0/8
  ["::ffff:169.254.0.0", 112], // 169.254.0.0/16 (link-local)
  ["::ffff:172.16.0.0", 108], // 172.16.0.0/12
  ["::ffff:192.168.0.0", 112], // 192.168.0.0/16
  ["::ffff:198.18.0.0", 111], // 198.18.0.0/15 (benchmarking)
  ["::ffff:224.0.0.0", 100], // 224.0.0.0/4 (multicast)
  ["::ffff:240.0.0.0", 100], // 240.0.0.0/4 (reserved)
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family === 0 ||
    blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

export async function safeOutboundFetch(
  rawUrl: string,
  options: RequestInit,
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
  if (isIP(hostname) && isBlockedAddress(hostname)) {
    throw new Error("Private destinations are not allowed");
  }

  const dispatcher = new Agent({
    connect: {
      lookup(host, lookupOptions, callback) {
        lookup(
          host,
          { ...lookupOptions, all: true, verbatim: true },
          (error, addresses) => {
            if (error) return callback(error, "", 0);
            if (
              !addresses.length ||
              addresses.some(({ address }) => isBlockedAddress(address))
            ) {
              return callback(
                new Error("Private destinations are not allowed"),
                "",
                0,
              );
            }
            const selected = addresses[0];
            callback(null, selected.address, selected.family);
          },
        );
      },
    },
  });

  try {
    return await fetch(url, {
      ...options,
      redirect: "error",
      dispatcher,
    } as RequestInit & { dispatcher: Agent });
  } finally {
    await dispatcher.close();
  }
}
