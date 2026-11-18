/**
 * Other ways to reach a host, provided by plugins through
 * ctx.ssh.transports.provide. A provider claims some hosts by id and hands the
 * pipeline an open stream to them instead of a TCP connection, for example a
 * relay through another Termix server. The first provider that claims a host
 * wins, and nothing else (jump hosts, proxies) is tried for it.
 */

import type { Duplex } from "node:stream";
import type {
  PluginSshTransportHost,
  PluginSshTransportProvider,
} from "@termix-ssh/plugin-sdk/backend";

interface Entry {
  pluginId: string;
  provider: PluginSshTransportProvider;
}

const providers = new Map<symbol, Entry>();

export function provideSshTransport(
  pluginId: string,
  provider: PluginSshTransportProvider,
): () => void {
  const key = Symbol(pluginId);
  providers.set(key, { pluginId, provider });
  return () => {
    providers.delete(key);
  };
}

/** Test seam. */
export function clearSshTransports(): void {
  providers.clear();
}

/** A provider that takes longer than this to answer claims counts as no. */
export const CLAIM_TIMEOUT_MS = 2000;

async function claimedBy(
  provider: PluginSshTransportProvider,
  host: PluginSshTransportHost,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const answer = await Promise.race([
      Promise.resolve(provider.claims(host.id, host)),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), CLAIM_TIMEOUT_MS);
      }),
    ]);
    // Only a real true claims the host; a stray value never does.
    return answer === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Opens a stream to the host if a provider claims it, else null. */
export async function openProvidedTransport(
  host: PluginSshTransportHost,
): Promise<Duplex | null> {
  for (const { provider } of providers.values()) {
    if (await claimedBy(provider, host)) return provider.open(host);
  }
  return null;
}
