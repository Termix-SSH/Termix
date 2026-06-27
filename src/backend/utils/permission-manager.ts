import type { Request, Response, NextFunction } from "express";
import { createCurrentRbacAccessRepository } from "../database/repositories/current-rbac-access-repository.js";
import { createCurrentRoleRepository } from "../database/repositories/current-role-repository.js";
import { createCurrentUserRepository } from "../database/repositories/current-user-repository.js";
import { createCurrentHostResolutionRepository } from "../database/repositories/current-host-resolution-repository.js";
import { databaseLogger } from "./logger.js";

interface AuthenticatedRequest extends Request {
  userId?: string;
  dataKey?: Buffer;
}

interface HostAccessInfo {
  hasAccess: boolean;
  isOwner: boolean;
  isShared: boolean;
  permissionLevel?: "view";
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

    setInterval(() => {
      this.clearPermissionCache();
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

  private clearPermissionCache(): void {
    this.permissionCache.clear();
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
    action: "read" | "write" | "execute" | "delete" | "share" = "read",
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

        if (action === "write" || action === "delete") {
          return {
            hasAccess: false,
            isOwner: false,
            isShared: true,
            permissionLevel: access.permissionLevel as "view",
            expiresAt: access.expiresAt,
          };
        }

        try {
          await createCurrentRbacAccessRepository().touchHostAccess(access.id);
        } catch (error) {
          databaseLogger.warn("Failed to update host access timestamp", {
            operation: "update_host_access_timestamp",
            error,
          });
        }

        return {
          hasAccess: true,
          isOwner: false,
          isShared: true,
          permissionLevel: access.permissionLevel as "view",
          expiresAt: access.expiresAt,
        };
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
    action: "read" | "write" | "execute" | "delete" | "share" = "read",
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

export { PermissionManager };
export type { AuthenticatedRequest, HostAccessInfo, PermissionCheckResult };
