/**
 * Other ways to reach a host, provided by plugins through
 * ctx.ssh.transports.provide. A provider claims some hosts by id and hands the
 * pipeline an open stream to them instead of a TCP connection, for example a
 * relay through another Termix server. The first provider that claims a host
 * wins, and nothing else (jump hosts, proxies) is tried for it.
 */

import type { Duplex } from "node:stream";
import type { PluginSshTransportProvider } from "@termix-ssh/plugin-sdk/backend";

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

/** Opens a stream to the host if a provider claims it, else null. */
export async function openProvidedTransport(host: {
  id: number;
  ip: string;
  port: number;
}): Promise<Duplex | null> {
  for (const { provider } of providers.values()) {
    let claimed = false;
    try {
      claimed = provider.claims(host.id);
    } catch {
      claimed = false;
    }
    if (claimed) return provider.open(host);
  }
  return null;
}
