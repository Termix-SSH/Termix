import type { Client } from "ssh2";
import type {
  PluginSsh,
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
