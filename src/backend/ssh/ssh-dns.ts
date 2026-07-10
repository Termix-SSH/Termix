import dns from "dns/promises";
import net from "net";

export const SSH_DNS_RETRY_DELAYS_MS = [250, 750, 1500];

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
      const result = await lookup(normalized);
      return {
        host: result.address,
        resolvedAddress: result.address,
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
