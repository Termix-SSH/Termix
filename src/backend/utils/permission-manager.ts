import type { Request, Response, NextFunction } from "express";
import { db } from "../database/db/index.js";
import {
  hostAccess,
  roles,
  userRoles,
  sshData,
  users,
} from "../database/db/schema.js";
import { eq, and, or, isNull, gte, sql } from "drizzle-orm";
import { databaseLogger } from "./logger.js";

interface AuthenticatedRequest extends Request {
  userId?: string;
  dataKey?: Buffer;
}

interface HostAccessInfo {
  hasAccess: boolean;
  isOwner: boolean;
  isShared: boolean;
  permissionLevel?: string;
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
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    this.permissionCache = new Map();

    // Auto-cleanup expired host access every 1 minute
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

    // Clear permission cache every 5 minutes
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

  /**
   * Clean up expired host access entries
   */
  private async cleanupExpiredAccess(): Promise<void> {
    try {
      const now = new Date().toISOString();
      const result = await db
        .delete(hostAccess)
        .where(
          and(
            sql`${hostAccess.expiresAt} IS NOT NULL`,
            sql`${hostAccess.expiresAt} <= ${now}`,
          ),
        )
        .returning({ id: hostAccess.id });

      if (result.length > 0) {
        databaseLogger.info("Cleaned up expired host access", {
          operation: "host_access_cleanup",
          count: result.length,
        });
      }
    } catch (error) {
      databaseLogger.error("Failed to cleanup expired host access", error, {
        operation: "host_access_cleanup_failed",
      });
    }
  }

  /**
   * Clear permission cache
   */
  private clearPermissionCache(): void {
    this.permissionCache.clear();
  }

  /**
   * Invalidate permission cache for a specific user
   */
  invalidateUserPermissionCache(userId: string): void {
    this.permissionCache.delete(userId);
  }

  /**
   * Get user permissions from roles
   */
  async getUserPermissions(userId: string): Promise<string[]> {
    // Check cache first
    const cached = this.permissionCache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.permissions;
    }

    try {
      const userRoleRecords = await db
        .select({
          permissions: roles.permissions,
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, userId));

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

      // Cache the result
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

  /**
   * Check if user has a specific permission
   * Supports wildcards: "hosts.*", "*"
   */
  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(userId);

    // Check for wildcard "*" (god mode)
    if (userPermissions.includes("*")) {
      return true;
    }

    // Check exact match
    if (userPermissions.includes(permission)) {
      return true;
    }

    // Check wildcard matches
    const parts = permission.split(".");
    for (let i = parts.length; i > 0; i--) {
      const wildcardPermission = parts.slice(0, i).join(".") + ".*";
      if (userPermissions.includes(wildcardPermission)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if user can access a specific host
   */
  async canAccessHost(
    userId: string,
    hostId: number,
    action: "read" | "write" | "execute" | "delete" | "share" = "read",
  ): Promise<HostAccessInfo> {
    try {
      // Check if user is the owner
      const host = await db
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId)))
        .limit(1);

      if (host.length > 0) {
        return {
          hasAccess: true,
          isOwner: true,
          isShared: false,
        };
      }

      // Get user's role IDs
      const userRoleIds = await db
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(eq(userRoles.userId, userId));
      const roleIds = userRoleIds.map((r) => r.roleId);

      // Check if host is shared with user OR user's roles
      const now = new Date().toISOString();
      const sharedAccess = await db
        .select()
        .from(hostAccess)
        .where(
          and(
            eq(hostAccess.hostId, hostId),
            or(
              eq(hostAccess.userId, userId),
              roleIds.length > 0
                ? sql`${hostAccess.roleId} IN (${sql.join(
                    roleIds.map((id) => sql`${id}`),
                    sql`, `,
                  )})`
                : sql`false`,
            ),
            or(isNull(hostAccess.expiresAt), gte(hostAccess.expiresAt, now)),
          ),
        )
        .limit(1);

      if (sharedAccess.length > 0) {
        const access = sharedAccess[0];

        // Check permission level for write/delete actions
        if (action === "write" || action === "delete") {
          const level = access.permissionLevel;
          if (level === "view" || level === "readonly") {
            return {
              hasAccess: false,
              isOwner: false,
              isShared: true,
              permissionLevel: level,
              expiresAt: access.expiresAt,
            };
          }
        }

        // Update last accessed time
        try {
          db.update(hostAccess)
            .set({
              lastAccessedAt: now,
              accessCount: sql`${hostAccess.accessCount} + 1`,
            })
            .where(eq(hostAccess.id, access.id))
            .run();
        } catch (error) {
          databaseLogger.warn("Failed to update host access stats", {
            operation: "update_host_access_stats",
            error,
          });
        }

        return {
          hasAccess: true,
          isOwner: false,
          isShared: true,
          permissionLevel: access.permissionLevel,
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

  /**
   * Check if user is admin (backward compatibility)
   */
  async isAdmin(userId: string): Promise<boolean> {
    try {
      // Check old is_admin field
      const user = await db
        .select({ isAdmin: users.is_admin })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (user.length > 0 && user[0].isAdmin) {
        return true;
      }

      // Check if user has admin or super_admin role
      const adminRoles = await db
        .select({ roleName: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(
          and(
            eq(userRoles.userId, userId),
            or(eq(roles.name, "admin"), eq(roles.name, "super_admin")),
          ),
        );

      return adminRoles.length > 0;
    } catch (error) {
      databaseLogger.error("Failed to check admin status", error, {
        operation: "is_admin",
        userId,
      });
      return false;
    }
  }

  /**
   * Middleware: Require specific permission
   */
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

  /**
   * Middleware: Require host access
   */
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

      const hostId = parseInt(req.params[hostIdParam], 10);

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

      // Attach access info to request for use in route handlers
      (req as any).hostAccessInfo = accessInfo;

      next();
    };
  }

  /**
   * Middleware: Require admin role (backward compatible)
   */
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
