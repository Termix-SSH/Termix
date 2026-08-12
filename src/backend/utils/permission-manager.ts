import type { Request, Response, NextFunction } from "express";
import {
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentUserRepository,
  createCurrentHostResolutionRepository,
} from "../database/repositories/factory.js";
import { databaseLogger } from "./logger.js";

interface AuthenticatedRequest extends Request {
  userId?: string;
  dataKey?: Buffer;
}

const SHARE_PERMISSION_LEVELS = ["connect", "view", "edit", "manage"] as const;

type SharePermissionLevel = (typeof SHARE_PERMISSION_LEVELS)[number];

export type HostAction = SharePermissionLevel | "delete";

const LEVEL_RANK: Record<SharePermissionLevel, number> = {
  connect: 1,
  view: 2,
  edit: 3,
  manage: 4,
};

function normalizeSharePermissionLevel(
  level: string | null | undefined,
): SharePermissionLevel {
  return SHARE_PERMISSION_LEVELS.includes(level as SharePermissionLevel)
    ? (level as SharePermissionLevel)
    : "connect";
}

interface HostAccessInfo {
  hasAccess: boolean;
  isOwner: boolean;
  isShared: boolean;
  isAdminBypass?: boolean;
  permissionLevel?: SharePermissionLevel;
  expiresAt?: string | null;
}

interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

class PermissionManager {
  private static instance: PermissionManager;
  private permissionCache: Map<
    string,
    { permissions: string[]; timestamp: number }
  >;
  private readonly CACHE_TTL = 5 * 60 * 1000;

  private constructor() {
    this.permissionCache = new Map();

    setInterval(() => {
      this.cleanupExpiredAccess().catch((error) => {
        databaseLogger.error(
          "Failed to run periodic host access cleanup",
          error,
          {
            operation: "host_access_cleanup_periodic",
          },
        );
      });
    }, 60 * 1000);

    // Entries expire on read against their own timestamp, so this sweep only
    // has to drop ones nobody has come back for. Flushing the whole map on a
    // timer instead expired every active user at the same instant, so each
    // sweep was followed by a burst of simultaneous role lookups.
    setInterval(() => {
      this.evictExpiredPermissions();
    }, this.CACHE_TTL);
  }

  static getInstance(): PermissionManager {
    if (!this.instance) {
      this.instance = new PermissionManager();
    }
    return this.instance;
  }

  private async cleanupExpiredAccess(): Promise<void> {
    try {
      await createCurrentRbacAccessRepository().deleteExpiredHostAccess();
    } catch (error) {
      databaseLogger.error("Failed to cleanup expired host access", error, {
        operation: "host_access_cleanup_failed",
      });
    }
  }

  private evictExpiredPermissions(): void {
    const now = Date.now();
    for (const [userId, entry] of this.permissionCache) {
      if (now - entry.timestamp >= this.CACHE_TTL) {
        this.permissionCache.delete(userId);
      }
    }
  }

  invalidateUserPermissionCache(userId: string): void {
    this.permissionCache.delete(userId);
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    const cached = this.permissionCache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.permissions;
    }

    try {
      const userRoleRecords =
        await createCurrentRoleRepository().listUserRolePermissions(userId);

      const allPermissions = new Set<string>();
      for (const record of userRoleRecords) {
        try {
          const permissions = JSON.parse(record.permissions) as string[];
          for (const perm of permissions) {
            allPermissions.add(perm);
          }
        } catch (parseError) {
          databaseLogger.warn("Failed to parse role permissions", {
            operation: "get_user_permissions",
            userId,
            error: parseError,
          });
        }
      }

      const permissionsArray = Array.from(allPermissions);

      this.permissionCache.set(userId, {
        permissions: permissionsArray,
        timestamp: Date.now(),
      });

      return permissionsArray;
    } catch (error) {
      databaseLogger.error("Failed to get user permissions", error, {
        operation: "get_user_permissions",
        userId,
      });
      return [];
    }
  }

  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(userId);

    if (userPermissions.includes("*")) {
      return true;
    }

    if (userPermissions.includes(permission)) {
      return true;
    }

    const parts = permission.split(".");
    for (let i = parts.length; i > 0; i--) {
      const wildcardPermission = parts.slice(0, i).join(".") + ".*";
      if (userPermissions.includes(wildcardPermission)) {
        return true;
      }
    }

    return false;
  }

  async canAccessHost(
    userId: string,
    hostId: number,
    action: HostAction = "connect",
  ): Promise<HostAccessInfo> {
    try {
      const hostResolutionRepository = createCurrentHostResolutionRepository();

      if (await hostResolutionRepository.isHostOwnedByUser(hostId, userId)) {
        return {
          hasAccess: true,
          isOwner: true,
          isShared: false,
        };
      }

      const roleIds =
        await createCurrentRoleRepository().listUserRoleIds(userId);

      const access =
        await createCurrentRbacAccessRepository().findActiveHostAccess(
          hostId,
          userId,
          roleIds,
        );

      if (access) {
        const ownerId = await hostResolutionRepository.findHostOwnerId(hostId);

        if (ownerId === userId) {
          return {
            hasAccess: true,
            isOwner: true,
            isShared: false,
          };
        }

        const grantedLevel = normalizeSharePermissionLevel(
          access.permissionLevel,
        );

        if (
          action === "delete" ||
          LEVEL_RANK[grantedLevel] < LEVEL_RANK[action]
        ) {
          if (await this.isAdmin(userId)) {
            return this.adminBypassAccess();
          }
          return {
            hasAccess: false,
            isOwner: false,
            isShared: true,
            permissionLevel: grantedLevel,
            expiresAt: access.expiresAt,
          };
        }

        if (action === "connect") {
          try {
            await createCurrentRbacAccessRepository().touchHostAccess(
              access.id,
            );
          } catch (error) {
            databaseLogger.warn("Failed to update host access timestamp", {
              operation: "update_host_access_timestamp",
              error,
            });
          }
        }

        return {
          hasAccess: true,
          isOwner: false,
          isShared: true,
          permissionLevel: grantedLevel,
          expiresAt: access.expiresAt,
        };
      }

      if (await this.isAdmin(userId)) {
        return this.adminBypassAccess();
      }

      return {
        hasAccess: false,
        isOwner: false,
        isShared: false,
      };
    } catch (error) {
      databaseLogger.error("Failed to check host access", error, {
        operation: "can_access_host",
        userId,
        hostId,
        action,
      });
      return {
        hasAccess: false,
        isOwner: false,
        isShared: false,
      };
    }
  }

  /**
   * The subset of `hostIds` this user may reach, resolved in a fixed number of
   * queries instead of one call per host.
   *
   * canAccessHost costs between one and four queries, so filtering a list with
   * it is linear in host count — and the status poll does exactly that every
   * few seconds for the whole fleet. This answers the same question for many
   * hosts at once using the same three rules, in the same order: owner, then
   * an unexpired grant, then admin bypass.
   *
   * Deliberately limited to read-style checks. It does not touch grant
   * timestamps the way `canAccessHost(..., "connect")` does, because this is
   * used for visibility filtering rather than for opening a connection.
   */
  async filterAccessibleHostIds(
    userId: string,
    hostIds: number[],
  ): Promise<Set<number>> {
    if (hostIds.length === 0) return new Set();

    try {
      if (await this.isAdmin(userId)) {
        return new Set(hostIds);
      }

      const owned =
        await createCurrentHostResolutionRepository().listOwnedHostIds(userId);

      const roleIds =
        await createCurrentRoleRepository().listUserRoleIds(userId);
      const grants =
        await createCurrentRbacAccessRepository().listVisibleHostAccessEntries(
          userId,
          roleIds,
        );
      const granted = new Set(grants.map((grant) => grant.hostId));

      return new Set(hostIds.filter((id) => owned.has(id) || granted.has(id)));
    } catch (error) {
      databaseLogger.error("Failed to filter accessible hosts", error, {
        operation: "filter_accessible_hosts",
        userId,
      });
      // Fail closed: showing nothing is safer than showing another
      // tenant's hosts.
      return new Set();
    }
  }

  // Admins get owner-equivalent access to every host; each connect is
  // audit-logged in the host resolver.
  private adminBypassAccess(): HostAccessInfo {
    return {
      hasAccess: true,
      isOwner: false,
      isShared: false,
      isAdminBypass: true,
      permissionLevel: "manage",
    };
  }

  async isAdmin(userId: string): Promise<boolean> {
    try {
      const user = await createCurrentUserRepository().findById(userId);

      if (user?.isAdmin) {
        return true;
      }

      return createCurrentRoleRepository().userHasAnyRoleName(userId, [
        "admin",
        "super_admin",
      ]);
    } catch (error) {
      databaseLogger.error("Failed to check admin status", error, {
        operation: "is_admin",
        userId,
      });
      return false;
    }
  }

  requirePermission(permission: string) {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction,
    ) => {
      const userId = req.userId;

      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const hasPermission = await this.hasPermission(userId, permission);

      if (!hasPermission) {
        databaseLogger.warn("Permission denied", {
          operation: "permission_check",
          userId,
          permission,
          path: req.path,
        });

        return res.status(403).json({
          error: "Insufficient permissions",
          required: permission,
        });
      }

      next();
    };
  }

  requireHostAccess(
    hostIdParam: string = "id",
    action: HostAction = "connect",
  ) {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction,
    ) => {
      const userId = req.userId;

      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const hostIdValue = Array.isArray(req.params[hostIdParam])
        ? req.params[hostIdParam][0]
        : req.params[hostIdParam];
      const hostId = parseInt(hostIdValue, 10);

      if (isNaN(hostId)) {
        return res.status(400).json({ error: "Invalid host ID" });
      }

      const accessInfo = await this.canAccessHost(userId, hostId, action);

      if (!accessInfo.hasAccess) {
        databaseLogger.warn("Host access denied", {
          operation: "host_access_check",
          userId,
          hostId,
          action,
        });

        return res.status(403).json({
          error: "Access denied to host",
          hostId,
          action,
        });
      }

      (req as unknown as { hostAccessInfo: HostAccessInfo }).hostAccessInfo =
        accessInfo;

      next();
    };
  }

  requireAdmin() {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction,
    ) => {
      const userId = req.userId;

      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const isAdmin = await this.isAdmin(userId);

      if (!isAdmin) {
        databaseLogger.warn("Admin access denied", {
          operation: "admin_check",
          userId,
          path: req.path,
        });

        return res.status(403).json({ error: "Admin access required" });
      }

      next();
    };
  }
}

export { PermissionManager, SHARE_PERMISSION_LEVELS, LEVEL_RANK };
export type {
  AuthenticatedRequest,
  HostAccessInfo,
  PermissionCheckResult,
  SharePermissionLevel,
};
