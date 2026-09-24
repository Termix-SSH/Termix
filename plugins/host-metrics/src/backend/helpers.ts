import type { PluginSsh, PluginSshHost } from "@termix/plugin-sdk/backend";

/** A host as ctx.ssh.resolveHost returns it, with the fields polling reads. */
export type MetricsHost = PluginSshHost & {
  userId: string;
  name?: string | null;
  connectionType?: string | null;
  enableSsh?: boolean | null;
  password?: string | null;
  sudoPassword?: string | null;
  terminalConfig?: { sudoPassword?: string | null } | null;
  enableDocker?: boolean | null;
  jumpHosts?: Array<{ hostId: number }> | null;
};

/** Metrics run over SSH, unattended, so the auth type has to allow that. */
export function supportsMetrics(
  host: Pick<MetricsHost, "connectionType" | "enableSsh" | "authType">,
  ssh: Pick<PluginSsh, "supportsBackground">,
): boolean {
  const connectionType = host.connectionType || "ssh";
  if (connectionType !== "ssh" && host.enableSsh !== true) return false;
  return ssh.supportsBackground(host.authType || "none");
}

export function sudoPasswordOf(host: MetricsHost): string | undefined {
  return host.sudoPassword || host.terminalConfig?.sudoPassword || undefined;
}

export type ConnectionLogType = "info" | "success" | "warning" | "error";

export interface ConnectionLog {
  type: ConnectionLogType;
  stage: string;
  message: string;
  details?: Record<string, unknown>;
}

/** The entry shape the connection log panel reads. */
export function connectionLog(
  type: ConnectionLogType,
  stage: string,
  message: string,
  details?: Record<string, unknown>,
): ConnectionLog {
  return { type, stage, message, ...(details ? { details } : {}) };
}

export function newSessionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
