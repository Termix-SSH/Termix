import type { Client } from "ssh2";
import type { SSHHost } from "../../types/index.js";
import {
  connectHost,
  getConnectionPoolKey,
  SshConnectError,
} from "./connect/connect-host.js";
import { buildConnectConfig } from "./connect/build-connect-config.js";
import type { MutableConnectConfig, SshConnectHost } from "./connect/types.js";

/**
 * Non-interactive SSH connections for background work (fleets, automations,
 * AI tools). A thin wrapper over the connect pipeline, kept so the pool keys
 * and call sites stay the same.
 */

export function getFleetPoolKey(host: SSHHost): string {
  return getConnectionPoolKey("fleet", host as unknown as SshConnectHost);
}

export async function buildFleetSshConfig(
  host: SSHHost,
  client?: Client,
): Promise<MutableConnectConfig> {
  const { Client: SshClient } = await import("ssh2");
  const built = await buildConnectConfig(host as unknown as SshConnectHost, {
    userId: host.userId || "",
    purpose: "fleet",
    client: client ?? new SshClient(),
  });
  if (built.outcome.status !== "ready") {
    throw new SshConnectError(built.outcome);
  }
  return built.config;
}

export function createFleetSshFactory(host: SSHHost): () => Promise<Client> {
  return async () => {
    const connection = await connectHost(host as unknown as SshConnectHost, {
      userId: host.userId || "",
      purpose: "fleet",
    });
    return connection.client;
  };
}
