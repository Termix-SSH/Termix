import type { Client } from "ssh2";
import type { RequestHandler } from "express";
import type { PluginHostShareLevel } from "@termix/plugin-sdk/backend";
import type { HostMetricsRepository } from "../repository.js";
import type { MetricsLogger } from "../log.js";

/** Minimal host shape managers need (includes the decrypted sudo password). */
export interface ManagerHost {
  id: number;
  userId: string;
  /** The user making the request, who may not own the host. */
  actorId: string;
  sudoPassword?: string;
  enableDocker?: boolean;
}

/**
 * Runs `fn` against a pooled SSH connection for the host, after verifying the
 * acting user has at least `level` access. Resolves the host (with
 * sudoPassword) so managers can elevate. Rejects with an access error if not
 * permitted.
 */
export type RunOnHost = <T>(
  hostId: number,
  level: PluginHostShareLevel,
  fn: (client: Client, host: ManagerHost) => Promise<T>,
) => Promise<T>;

export interface HealthCheckEvent {
  hostId: number;
  userId: string;
  checkId: string;
  ok: boolean;
  detail?: string;
}

export interface ManagerRoutesDeps {
  validateHostId: RequestHandler;
  runOnHost: RunOnHost;
  log: MetricsLogger;
  repository: HostMetricsRepository;
  onHealthCheck: (event: HealthCheckEvent) => void;
}
