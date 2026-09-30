import dns from "dns/promises";
import net from "net";

const SSH_DNS_RETRY_DELAYS_MS = [250, 750, 1500];

type Lookup = typeof dns.lookup;
type Sleep = (ms: number) => Promise<void>;
type SshConnectConfigHost = {
  host?: unknown;
};

const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isRetriableDnsError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown };
  return (
    err.code === "EAI_AGAIN" ||
    (typeof err.message === "string" && err.message.includes("EAI_AGAIN"))
  );
}

export function shouldResolveBeforeSshConnect(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").trim();
  if (!normalized) return false;
  return net.isIP(normalized) === 0;
}

type LookupResult = { address: string; family: number };

// Prefer IPv4: ssh2 gets one address and has no fallback, and a name that
// also has an AAAA record often points at a v6 address sshd is not bound to.
export function pickSshAddress(result: LookupResult | LookupResult[]): string {
  const list = Array.isArray(result) ? result : [result];
  if (list.length === 0)
    throw Object.assign(new Error("No address found"), { code: "ENOTFOUND" });
  return (list.find((entry) => entry.family === 4) ?? list[0]).address;
}

export async function resolveHostForSshConnect(
  host: string,
  lookup: Lookup = dns.lookup,
  retryDelaysMs = SSH_DNS_RETRY_DELAYS_MS,
  wait: Sleep = sleep,
): Promise<{ host: string; resolvedAddress?: string; attempts: number }> {
  const normalized = host.replace(/^\[|\]$/g, "").trim();
  if (!shouldResolveBeforeSshConnect(normalized)) {
    return { host: normalized || host, attempts: 0 };
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      const address = pickSshAddress(await lookup(normalized, { all: true }));
      return {
        host: address,
        resolvedAddress: address,
        attempts: attempt + 1,
      };
    } catch (error) {
      if (!isRetriableDnsError(error) || attempt >= retryDelaysMs.length) {
        throw error;
      }
      await wait(retryDelaysMs[attempt]);
    }
  }
}

export async function resolveSshConnectConfigHost<
  T extends SshConnectConfigHost,
>(
  config: T,
  lookup: Lookup = dns.lookup,
  retryDelaysMs = SSH_DNS_RETRY_DELAYS_MS,
  wait: Sleep = sleep,
): Promise<
  T & { host?: unknown; resolvedHost?: string; originalHost?: string }
> {
  if (typeof config.host !== "string") return config;

  const originalHost = config.host;
  const resolution = await resolveHostForSshConnect(
    originalHost,
    lookup,
    retryDelaysMs,
    wait,
  );
  if (!resolution.resolvedAddress) return config;

  config.host = resolution.host;
  return Object.assign(config, {
    originalHost,
    resolvedHost: resolution.resolvedAddress,
  });
}
