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
  // IPv4-mapped equivalents of the blocked IPv4 ranges above, expressed
  // individually rather than as a blanket "::ffff:0:0/96": Node's BlockList
  // compares IPv4 addresses against their mapped-IPv6 form internally, so a
  // full "::ffff:0:0/96" entry matches every IPv4 address, not just spoofed
  // ones passed as literal IPv6 strings.
  ["::ffff:0.0.0.0", 104],
  ["::ffff:10.0.0.0", 104],
  ["::ffff:100.64.0.0", 106],
  ["::ffff:127.0.0.0", 104],
  ["::ffff:169.254.0.0", 112],
  ["::ffff:172.16.0.0", 108],
  ["::ffff:192.168.0.0", 112],
  ["::ffff:198.18.0.0", 111],
  ["::ffff:224.0.0.0", 100],
  ["::ffff:240.0.0.0", 100],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function isBlockedAddress(address: string): boolean {
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
