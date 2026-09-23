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
  PluginHostAccess,
  PluginHostShareLevel,
  PluginHostShareResult,
  PluginShareTarget,
  PluginShareableUser,
  PluginShareableRole,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { assertCapability } from "./permissions.js";
import { getActor } from "./actor.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
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

function actingUser(): string {
  const actor = getActor();
  if (!actor) {
    throw new Error(
      "ctx.hosts needs an acting user: call it inside a request or ctx.asUser",
    );
  }
  return actor;
}

export function createPluginHosts({ manifest, audit }: Deps): PluginHosts {
  const pluginId = manifest.id;
  const declared = manifest.capabilities;

  const requireRead = () => assertCapability(pluginId, "hosts:read", declared);
  const requireWrite = () =>
    assertCapability(pluginId, "hosts:write", declared);

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
  };
}
