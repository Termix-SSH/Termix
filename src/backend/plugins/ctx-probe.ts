/**
 * Reachability for status providers: ctx.network.tcpProbe, ctx.ssh.probe and
 * ctx.hosts.probeTargets. Nothing here ever logs in to the probed host.
 */

import type {
  PluginHostProbeTarget,
  PluginNetwork,
} from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import { assertCapability } from "./permissions.js";
import { getActor } from "./actor.js";
import { tcpPing } from "./probe/tcp-ping.js";
import { sharedJumpProbes } from "./probe/jump-probe-pool.js";
import type { HostStatusTargetRow } from "../database/repositories/host-resolution-repository.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 5000;

function clampTimeout(value?: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, n));
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function parseJumpHosts(raw: string | null): Array<{ hostId: number }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (hop): hop is { hostId: number } =>
            !!hop && Number.isInteger((hop as { hostId?: unknown }).hostId),
        )
      : [];
  } catch {
    return [];
  }
}

function toTarget(row: HostStatusTargetRow): PluginHostProbeTarget {
  return {
    id: row.id,
    ownerUserId: row.userId,
    ip: row.ip,
    port: row.port,
    connectionType: row.connectionType || "ssh",
    jumpHosts: parseJumpHosts(row.jumpHosts),
    statusCheckEnabled: row.statusCheckEnabled !== false,
    statusCheckInterval: row.statusCheckInterval ?? null,
  };
}

export function createPluginNetwork(deps: {
  manifest: PluginManifest;
  audit: AuditFn;
}): PluginNetwork {
  const { manifest, audit } = deps;
  let audited = false;
  return {
    tcpProbe: async (host, port, options) => {
      await assertCapability(
        manifest.id,
        "network:probe",
        manifest.capabilities,
        "network_tcp_probe",
      );
      if (typeof host !== "string" || !host.trim() || host.length > 255) {
        throw new Error("A host name or address is required");
      }
      if (!validPort(port))
        throw new Error("A port from 1 to 65535 is required");
      if (!audited) {
        audited = true;
        await audit("network_tcp_probe", "checked if TCP ports answer", {
          success: true,
        });
      }
      return tcpPing(host.trim(), port, clampTimeout(options?.timeoutMs));
    },
  };
}

/** The hosts the actor owns or was shared, narrowed to ones they may connect to. */
export async function loadProbeTargets(
  actor: string,
  hostIds?: number[],
): Promise<PluginHostProbeTarget[]> {
  const {
    createCurrentHostResolutionRepository,
    createCurrentRbacAccessRepository,
    createCurrentRoleRepository,
  } = await import("../database/repositories/factory.js");
  const { PermissionManager } = await import("../utils/permission-manager.js");
  const hosts = createCurrentHostResolutionRepository();

  const own = await hosts.listStatusTargets({
    userId: actor,
    hostIds,
  });
  const ownIds = new Set(own.map((row) => row.id));

  const roleIds = await createCurrentRoleRepository().listUserRoleIds(actor);
  const entries =
    await createCurrentRbacAccessRepository().listVisibleHostAccessEntries(
      actor,
      roleIds,
    );
  let sharedIds = [...new Set(entries.map((entry) => entry.hostId))].filter(
    (id) => !ownIds.has(id) && (!hostIds || hostIds.includes(id)),
  );
  if (sharedIds.length > 0) {
    const allowed =
      await PermissionManager.getInstance().filterAccessibleHostIds(
        actor,
        sharedIds,
      );
    sharedIds = sharedIds.filter((id) => allowed.has(id));
  }
  const shared =
    sharedIds.length > 0
      ? await hosts.listStatusTargets({ hostIds: sharedIds })
      : [];
  return [...own, ...shared].map(toTarget);
}

export async function probeHost(
  hostId: number,
  options?: { port?: number; timeoutMs?: number },
): Promise<boolean> {
  const actor = getActor();
  if (actor) {
    const { PermissionManager } =
      await import("../utils/permission-manager.js");
    const access = await PermissionManager.getInstance().canAccessHost(
      actor,
      hostId,
      "connect",
    );
    if (!access.hasAccess) return false;
  }
  const { createCurrentHostResolutionRepository } =
    await import("../database/repositories/factory.js");
  const [row] = await createCurrentHostResolutionRepository().listStatusTargets(
    { hostIds: [hostId] },
  );
  if (!row) return false;
  const target = toTarget(row);
  const port = options?.port ?? target.port;
  if (!validPort(port)) throw new Error("A port from 1 to 65535 is required");
  const timeout = clampTimeout(options?.timeoutMs);
  return target.jumpHosts.length > 0
    ? sharedJumpProbes.ping(
        target.jumpHosts,
        target.ownerUserId,
        target.ip,
        port,
        timeout,
      )
    : tcpPing(target.ip, port, timeout);
}
