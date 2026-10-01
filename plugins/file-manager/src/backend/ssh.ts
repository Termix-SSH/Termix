import type { Client, ConnectConfig } from "ssh2";
import type {
  PluginSsh,
  PluginSshAuthOutcome,
  PluginSshConnection,
  PluginSshConnectOptions,
  PluginSshHost,
} from "@termix/plugin-sdk/backend";

let current: PluginSsh | null = null;

/** Set in activate, cleared on deactivate. */
export function setPluginSsh(ssh: PluginSsh | null): void {
  current = ssh;
}

export function pluginSsh(): PluginSsh {
  if (!current) throw new Error("The plugin is not active");
  return current;
}

/** withConnection with ssh2's Client type filled in. */
export function withSshConnection<T>(
  host: number | PluginSshHost,
  options: PluginSshConnectOptions & { pool: string },
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  return pluginSsh().withConnection<T, Client>(host, options, fn);
}

/** connect with ssh2's Client type filled in. */
export function connectSsh(
  host: number | PluginSshHost,
  options?: PluginSshConnectOptions,
): Promise<PluginSshConnection<Client>> {
  return pluginSsh().connect<Client>(host, options);
}

/**
 * Lower-level primitives for the interactive /connect route, which drives its
 * own ssh2 Client through the TOTP and browser sign-in parking flow rather than letting
 * ctx.ssh.connect finish the handshake itself.
 */
export function prepareSsh(
  host: PluginSshHost,
  options: {
    purpose?: "file-manager" | "file-transfer";
    client: Client;
    serverHostId?: number;
    log?: (level: "info" | "warning" | "error", message: string) => void;
  },
): Promise<{ config: ConnectConfig; outcome: PluginSshAuthOutcome }> {
  return pluginSsh().prepare(host, options) as Promise<{
    config: ConnectConfig;
    outcome: PluginSshAuthOutcome;
  }>;
}

export function openSshTransport(
  host: PluginSshHost,
  config: ConnectConfig,
): Promise<{ jumpClient: Client | null; via: string }> {
  return pluginSsh().openTransport(
    host,
    config as unknown as Record<string, unknown>,
  ) as Promise<{
    jumpClient: Client | null;
    via: string;
  }>;
}

export const classifyKeyboardInteractive: PluginSsh["classifyKeyboardInteractive"] =
  (round, host) => pluginSsh().classifyKeyboardInteractive(round, host);

export const autoResponses: PluginSsh["autoResponses"] = (prompts, password) =>
  pluginSsh().autoResponses(prompts, password);

export const requiresSecret: PluginSsh["requiresSecret"] = (authType) =>
  pluginSsh().requiresSecret(authType);
