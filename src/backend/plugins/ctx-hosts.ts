/**
 * ctx.hosts: the hosts a plugin's acting user can see, and the sharing
 * operations that need core's RBAC and secret-snapshot machinery.
 *
 * list/get/checkAccess need hosts:read. share and the share-target pickers
 * need hosts:write, because granting access to a host is a write on that
 * host even though the plugin owns neither the host nor the grant.
 */

import type {
  PluginHosts,
  PluginHostSummary,
  PluginHostRecord,
  PluginHostCreateInput,
  PluginHostUpdateInput,
  PluginHostAccess,
  PluginHostShareLevel,
  PluginHostShareResult,
  PluginShareTarget,
  PluginShareableUser,
  PluginShareableRole,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { assertCapability, capabilityRefused } from "./permissions.js";
import { hostSessionStatus } from "../hosts/host-session-status.js";
import { getActor } from "./actor.js";
import { hostStatusService } from "../hosts/status/host-status-service.js";
import type { DisposableBag } from "./disposables.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
  /** Where registerPort entries go, so deactivate removes them. */
  bag?: DisposableBag;
  audit: AuditFn;
}

function toSummary(host: {
  id: number;
  userId: string;
  name: string | null;
  ip: string;
  port: number;
  username: string;
  tags: string | null;
  folder: string | null;
  authType: string;
}): PluginHostSummary {
  return {
    id: host.id,
    userId: host.userId,
    name: host.name,
    ip: host.ip,
    port: host.port,
    username: host.username,
    tags: host.tags,
    folder: host.folder,
    authType: host.authType,
  };
}

/**
 * Host fields that carry secret material. Stripped from anything ctx.hosts or
 * ctx.ssh hands a plugin, unless the plugin holds credentials:read.
 */
export const HOST_SECRET_FIELDS = [
  "password",
  "key",
  "keyPassword",
  "privateKey",
  "passphrase",
  "sudoPassword",
  "socks5Password",
  "rdpPassword",
  "vncPassword",
  "telnetPassword",
  "autostartPassword",
  "autostartKey",
  "autostartKeyPassword",
  "vaultToken",
] as const;

/** A copy of a host with every secret field removed, nested ones included. */
export function redactHostSecrets<T extends Record<string, unknown>>(
  host: T,
): T {
  const copy: Record<string, unknown> = { ...host };
  for (const field of HOST_SECRET_FIELDS) delete copy[field];
  const terminalConfig = copy.terminalConfig;
  if (terminalConfig && typeof terminalConfig === "object") {
    const { sudoPassword: _sudo, ...rest } = terminalConfig as Record<
      string,
      unknown
    >;
    copy.terminalConfig = rest;
  }
  if (Array.isArray(copy.socks5ProxyChain)) {
    copy.socks5ProxyChain = copy.socks5ProxyChain.map((hop) =>
      hop && typeof hop === "object"
        ? redactHostSecrets(hop as Record<string, unknown>)
        : hop,
    );
  }
  return copy as T;
}

/** Columns that say who a host belongs to. ctx.hosts.update never moves them. */
const PROTECTED_HOST_FIELDS = new Set(["id", "userId", "syncId"]);

function toRecord(host: Record<string, unknown>): PluginHostRecord {
  return redactHostSecrets({
    id: host.id as number,
    userId: host.userId as string,
    name: (host.name as string | null) ?? null,
    ip: host.ip as string,
    port: host.port as number,
    username: host.username as string,
    authType: host.authType as string,
    credentialId: (host.credentialId as number | null) ?? null,
    overrideCredentialUsername:
      (host.overrideCredentialUsername as boolean | null) ?? null,
    connectionType: (host.connectionType as string | null) ?? null,
    tags: (host.tags as string | null) ?? null,
    folder: (host.folder as string | null) ?? null,
    jumpHosts: host.jumpHosts,
    enableSsh: (host.enableSsh as boolean | null) ?? null,
    createdAt: (host.createdAt as string | null) ?? null,
    updatedAt: (host.updatedAt as string | null) ?? null,
    ...host,
  });
}

function actingUser(): string {
  const actor = getActor();
  if (!actor) {
    throw new Error(
      "ctx.hosts needs an acting user: call it inside a request or ctx.asUser",
    );
  }
  return actor;
}

export function createPluginHosts({ manifest, bag, audit }: Deps): PluginHosts {
  const pluginId = manifest.id;
  const declared = manifest.capabilities;

  const requireRead = () => assertCapability(pluginId, "hosts:read", declared);
  const requireReadSync = () => {
    if (!declared.includes("hosts:read")) {
      throw capabilityRefused(pluginId, "hosts:read");
    }
  };
  const requireWrite = () =>
    assertCapability(pluginId, "hosts:write", declared);

  // With an actor, a host the actor cannot reach is out of bounds. With none,
  // it is the plugin's own background work (a poller, a guacd session).
  const actorMayReach = async (hostId: number): Promise<boolean> => {
    const actor = getActor();
    if (!actor) return true;
    const { PermissionManager } =
      await import("../utils/permission-manager.js");
    const access = await PermissionManager.getInstance().canAccessHost(
      actor,
      hostId,
      "connect",
    );
    return access.hasAccess;
  };

  return {
    list: async () => {
      await requireRead();
      const userId = actingUser();
      const {
        createCurrentHostResolutionRepository,
        createCurrentRoleRepository,
        createCurrentRbacAccessRepository,
      } = await import("../database/repositories/factory.js");
      const repository = createCurrentHostResolutionRepository();

      const owned = await repository.findHostsByUserId(userId);
      const roleIds =
        await createCurrentRoleRepository().listUserRoleIds(userId);
      const grants =
        await createCurrentRbacAccessRepository().listVisibleHostAccessEntries(
          userId,
          roleIds,
        );
      const sharedRows = await repository.listHostRowsForAccessList(
        userId,
        grants,
      );

      const byId = new Map<number, PluginHostSummary>();
      for (const host of owned) byId.set(host.id, toSummary(host));
      for (const host of sharedRows) {
        if (!byId.has(host.id)) byId.set(host.id, toSummary(host));
      }
      return [...byId.values()];
    },

    get: async (hostId) => {
      await requireRead();
      const userId = actingUser();
      const { PermissionManager } =
        await import("../utils/permission-manager.js");
      const access = await PermissionManager.getInstance().canAccessHost(
        userId,
        hostId,
        "connect",
      );
      if (!access.hasAccess) return null;

      const { createCurrentHostResolutionRepository } =
        await import("../database/repositories/factory.js");
      const ownerId =
        (await createCurrentHostResolutionRepository().findHostOwnerId(
          hostId,
        )) ?? userId;
      const host = await createCurrentHostResolutionRepository().findHostById(
        hostId,
        ownerId,
      );
      return host ? toSummary(host) : null;
    },

    checkAccess: async (
      hostId: number,
      level: PluginHostShareLevel,
    ): Promise<PluginHostAccess> => {
      await requireRead();
      const userId = actingUser();
      const { PermissionManager } =
        await import("../utils/permission-manager.js");
      const access = await PermissionManager.getInstance().canAccessHost(
        userId,
        hostId,
        level,
      );
      return {
        hasAccess: access.hasAccess,
        isOwner: access.isOwner,
        isShared: access.isShared,
        permissionLevel: access.permissionLevel as
          PluginHostShareLevel | undefined,
        expiresAt: access.expiresAt,
      };
    },

    create: async (host: PluginHostCreateInput): Promise<PluginHostRecord> => {
      try {
        await requireWrite();
      } catch (error) {
        await audit("hosts_create", host.name ?? host.ip, {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const userId = actingUser();
      const { createCurrentHostRepository } =
        await import("../database/repositories/factory.js");
      const created =
        await createCurrentHostRepository().createEncryptedForUser(userId, {
          ...host,
          userId,
        });
      // Fields another plugin owns (a remote desktop switch) go to that
      // plugin's host settings, the same way a bulk import row's do.
      const { applyPluginHostImportSettings } =
        await import("../database/routes/host-plugin-settings.js");
      await applyPluginHostImportSettings(
        created.id,
        host as Record<string, unknown>,
      );
      await audit("hosts_create", `host ${created.id}`, { success: true });
      return toRecord(created as unknown as Record<string, unknown>);
    },

    update: async (
      hostId: number,
      patch: PluginHostUpdateInput,
    ): Promise<PluginHostRecord | null> => {
      try {
        await requireWrite();
      } catch (error) {
        await audit("hosts_update", `host ${hostId}`, {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const userId = actingUser();
      const allowed = Object.fromEntries(
        Object.entries(patch as Record<string, unknown>).filter(
          ([field]) => !PROTECTED_HOST_FIELDS.has(field),
        ),
      ) as PluginHostUpdateInput;
      const { createCurrentHostRepository } =
        await import("../database/repositories/factory.js");
      const updated =
        await createCurrentHostRepository().updateEncryptedForUser(
          userId,
          hostId,
          allowed,
        );
      await audit("hosts_update", `host ${hostId}`, {
        success: updated !== null,
      });
      return updated
        ? toRecord(updated as unknown as Record<string, unknown>)
        : null;
    },

    delete: async (hostId: number): Promise<boolean> => {
      try {
        await requireWrite();
        const userId = actingUser();
        const { PermissionManager } =
          await import("../utils/permission-manager.js");
        if (
          !(await PermissionManager.getInstance().hasPermission(
            userId,
            "hosts.delete",
          ))
        ) {
          throw new Error("The acting user may not delete hosts");
        }
        const { deleteOwnedHost } = await import("../hosts/delete-host.js");
        const deleted = await deleteOwnedHost(userId, hostId);
        await audit("hosts_delete", `host ${hostId}`, {
          success: deleted !== null,
        });
        return deleted !== null;
      } catch (error) {
        await audit("hosts_delete", `host ${hostId}`, {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    listOwned: async (): Promise<PluginHostRecord[]> => {
      await requireWrite();
      const userId = actingUser();
      const { createCurrentHostRepository } =
        await import("../database/repositories/factory.js");
      const rows =
        await createCurrentHostRepository().listDecryptedByUserId(userId);
      await audit("hosts_list_owned", `${rows.length} host(s)`, {
        success: true,
      });
      return rows.map((row) =>
        toRecord(row as unknown as Record<string, unknown>),
      );
    },

    share: async (
      hostId: number,
      targets: PluginShareTarget[],
      permissionLevel: PluginHostShareLevel,
      durationHours?: number,
    ): Promise<PluginHostShareResult> => {
      try {
        await requireWrite();
      } catch (error) {
        await audit("hosts_share", `host ${hostId}`, {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      const userId = actingUser();
      const { PermissionManager } =
        await import("../utils/permission-manager.js");
      const access = await PermissionManager.getInstance().canAccessHost(
        userId,
        hostId,
        "manage",
      );
      if (!access.hasAccess) {
        const result: PluginHostShareResult = {
          hostId,
          shared: false,
          reason: "forbidden",
        };
        await audit("hosts_share", `host ${hostId}`, {
          success: false,
          errorMessage: "forbidden",
        });
        return result;
      }

      const {
        createCurrentHostResolutionRepository,
        createCurrentRbacAccessRepository,
      } = await import("../database/repositories/factory.js");
      const ownerId =
        (await createCurrentHostResolutionRepository().findHostOwnerId(
          hostId,
        )) ?? userId;

      if (targets.some((t) => t.type === "user" && t.id === ownerId)) {
        await audit("hosts_share", `host ${hostId}`, {
          success: false,
          errorMessage: "owner",
        });
        return { hostId, shared: false, reason: "owner" };
      }

      const expiresAt =
        durationHours && durationHours > 0
          ? new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString()
          : null;

      const rbacAccessRepository = createCurrentRbacAccessRepository();
      const { SharedHostSecretsManager } =
        await import("../utils/shared-host-secrets-manager.js");
      const secretsManager = SharedHostSecretsManager.getInstance();

      for (const target of targets) {
        const grant = await rbacAccessRepository.upsertHostAccess({
          hostId,
          grantedBy: userId,
          permissionLevel,
          expiresAt,
          ...(target.type === "user"
            ? { targetType: "user" as const, targetUserId: target.id as string }
            : {
                targetType: "role" as const,
                targetRoleId: target.id as number,
              }),
        });

        try {
          if (target.type === "user") {
            await secretsManager.snapshotForUser(
              grant.id,
              hostId,
              target.id as string,
              ownerId,
            );
          } else {
            await secretsManager.snapshotForRole(
              grant.id,
              hostId,
              target.id as number,
              ownerId,
            );
          }
        } catch {
          // A snapshot failure never blocks the grant: the recipient can
          // still be prompted, or the owner can retry sharing later.
        }
      }

      await audit("hosts_share", `host ${hostId}`, { success: true });
      return { hostId, shared: true };
    },

    listUsers: async (): Promise<PluginShareableUser[]> => {
      try {
        await requireWrite();
      } catch (error) {
        await audit("hosts_list_users", "share target picker", {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const { createCurrentUserRepository } =
        await import("../database/repositories/factory.js");
      const users = await createCurrentUserRepository().listAll();
      await audit("hosts_list_users", "share target picker", {
        success: true,
      });
      return users.map((u) => ({ id: u.id, username: u.username }));
    },

    listRoles: async (): Promise<PluginShareableRole[]> => {
      try {
        await requireWrite();
      } catch (error) {
        await audit("hosts_list_roles", "share target picker", {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const { createCurrentRoleRepository } =
        await import("../database/repositories/factory.js");
      const roles = await createCurrentRoleRepository().listRoles();
      await audit("hosts_list_roles", "share target picker", {
        success: true,
      });
      return roles
        .filter((r) => !r.isSystem)
        .map((r) => ({ id: r.id, name: r.name, displayName: r.displayName }));
    },

    // Synchronous so a transport can call it from an ssh2 "ready" handler, so
    // only the declaration is checked up front, like ctx.http.router. The
    // session only counts once the actor's access to the host is confirmed.
    trackSession: (hostId: number) => {
      if (!declared.includes("hosts:read")) {
        throw capabilityRefused(pluginId, "hosts:read");
      }
      let release: (() => void) | null = null;
      let stopped = false;
      void actorMayReach(hostId)
        .then((allowed) => {
          if (allowed && !stopped) release = hostSessionStatus.register(hostId);
        })
        .catch(() => {});
      return () => {
        stopped = true;
        release?.();
        release = null;
      };
    },

    recordActivity: async (hostId, type, hostName) => {
      await requireRead();
      const userId = actingUser();
      if (!(await actorMayReach(hostId))) return;
      const { recordRecentActivity } =
        await import("../services/recent-activity.js");
      await recordRecentActivity(userId, { type, hostId, hostName });
    },

    // Not audited: pollers call these on every sample.
    status: {
      get: async (hostId) => {
        await requireRead();
        if (!(await actorMayReach(hostId))) return null;
        return hostStatusService.get(hostId);
      },
      check: async (hostId) => {
        await requireRead();
        if (!(await actorMayReach(hostId))) return null;
        return hostStatusService.check(hostId);
      },
      // Synchronous for the same reason as trackSession.
      reportLogin: (hostId, outcome) => {
        requireReadSync();
        void actorMayReach(hostId)
          .then((allowed) => {
            if (allowed) hostStatusService.reportLogin(hostId, outcome);
          })
          .catch(() => {});
      },
      registerPort: (connectionType, resolve) => {
        requireReadSync();
        const unregister = hostStatusService.registerPort(
          connectionType,
          resolve,
        );
        const drop = bag?.add(unregister, `status port for ${connectionType}`);
        return () => {
          drop?.();
          unregister();
        };
      },
    },
  };
}
