import type { Client } from "ssh2";
import type { RequestHandler } from "express";

/** Minimal host shape managers need (includes the decrypted sudo password). */
export interface ManagerHost {
  id: number;
  userId: string;
  sudoPassword?: string;
  enableDocker?: boolean;
}

/**
 * Runs `fn` against a pooled SSH connection for the host, after verifying the
 * user has at least `level` access. Resolves the host (with sudoPassword) so
 * managers can elevate. Rejects with an access error if not permitted.
 */
export type RunOnHost = <T>(
  hostId: number,
  userId: string,
  level: "read" | "execute",
  fn: (client: Client, host: ManagerHost) => Promise<T>,
) => Promise<T>;

export interface ManagerRoutesDeps {
  validateHostId: RequestHandler;
  runOnHost: RunOnHost;
}
