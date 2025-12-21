import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import {
  hostAccess,
  sshData,
  users,
  roles,
  userRoles,
  auditLogs,
} from "../db/schema.js";
import { eq, and, desc, sql, or, isNull, gte } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();

const authenticateJWT = authManager.createAuthMiddleware();

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Share a host with a user or role
 * POST /rbac/host/:id/share
 */
router.post(
  "/host/:id/share",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const hostId = parseInt(req.params.id, 10);
    const userId = req.userId!;

    if (isNaN(hostId)) {
      return res.status(400).json({ error: "Invalid host ID" });
    }

    try {
      const {
        targetType = "user", // "user" or "role"
        targetUserId,
        targetRoleId,
        durationHours,
        permissionLevel = "use",
      } = req.body;

      // Validate target type
      if (!["user", "role"].includes(targetType)) {
        return res
          .status(400)
          .json({ error: "Invalid target type. Must be 'user' or 'role'" });
      }

      // Validate required fields based on target type
      if (targetType === "user" && !isNonEmptyString(targetUserId)) {
        return res
          .status(400)
          .json({ error: "Target user ID is required when sharing with user" });
      }
      if (targetType === "role" && !targetRoleId) {
        return res
          .status(400)
          .json({ error: "Target role ID is required when sharing with role" });
      }

      // Verify user owns the host
      const host = await db
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId)))
        .limit(1);

      if (host.length === 0) {
        databaseLogger.warn("Attempt to share host not owned by user", {
          operation: "share_host",
          userId,
          hostId,
        });
        return res.status(403).json({ error: "Not host owner" });
      }

      // Check if host uses credentials (required for sharing)
      if (!host[0].credentialId) {
        return res.status(400).json({
          error:
            "Only hosts using credentials can be shared. Please create a credential and assign it to this host before sharing.",
          code: "CREDENTIAL_REQUIRED_FOR_SHARING",
        });
      }

      // Verify target exists (user or role)
      if (targetType === "user") {
        const targetUser = await db
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(eq(users.id, targetUserId))
          .limit(1);

        if (targetUser.length === 0) {
          return res.status(404).json({ error: "Target user not found" });
        }
      } else {
        const targetRole = await db
          .select({ id: roles.id, name: roles.name })
          .from(roles)
          .where(eq(roles.id, targetRoleId))
          .limit(1);

        if (targetRole.length === 0) {
          return res.status(404).json({ error: "Target role not found" });
        }
      }

      // Calculate expiry time
      let expiresAt: string | null = null;
      if (
        durationHours &&
        typeof durationHours === "number" &&
        durationHours > 0
      ) {
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + durationHours);
        expiresAt = expiryDate.toISOString();
      }

      // Validate permission level
      const validLevels = ["view", "use", "manage"];
      if (!validLevels.includes(permissionLevel)) {
        return res.status(400).json({
          error: "Invalid permission level",
          validLevels,
        });
      }

      // Check if access already exists
      const whereConditions = [eq(hostAccess.hostId, hostId)];
      if (targetType === "user") {
        whereConditions.push(eq(hostAccess.userId, targetUserId));
      } else {
        whereConditions.push(eq(hostAccess.roleId, targetRoleId));
      }

      const existing = await db
        .select()
        .from(hostAccess)
        .where(and(...whereConditions))
        .limit(1);

      if (existing.length > 0) {
        // Update existing access
        await db
          .update(hostAccess)
          .set({
            permissionLevel,
            expiresAt,
          })
          .where(eq(hostAccess.id, existing[0].id));

        databaseLogger.info("Updated existing host access", {
          operation: "share_host",
          hostId,
          targetType,
          targetUserId: targetType === "user" ? targetUserId : undefined,
          targetRoleId: targetType === "role" ? targetRoleId : undefined,
          permissionLevel,
          expiresAt,
        });

        return res.json({
          success: true,
          message: "Host access updated",
          expiresAt,
        });
      }

      // Create new access
      const result = await db.insert(hostAccess).values({
        hostId,
        userId: targetType === "user" ? targetUserId : null,
        roleId: targetType === "role" ? targetRoleId : null,
        grantedBy: userId,
        permissionLevel,
        expiresAt,
      });

      databaseLogger.info("Created host access", {
        operation: "share_host",
        hostId,
        hostName: host[0].name,
        targetType,
        targetUserId: targetType === "user" ? targetUserId : undefined,
        targetRoleId: targetType === "role" ? targetRoleId : undefined,
        permissionLevel,
        expiresAt,
      });

      res.json({
        success: true,
        message: `Host shared successfully with ${targetType}`,
        expiresAt,
      });
    } catch (error) {
      databaseLogger.error("Failed to share host", error, {
        operation: "share_host",
        hostId,
        userId,
      });
      res.status(500).json({ error: "Failed to share host" });
    }
  },
);

/**
 * Revoke host access
 * DELETE /rbac/host/:id/access/:accessId
 */
router.delete(
  "/host/:id/access/:accessId",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const hostId = parseInt(req.params.id, 10);
    const accessId = parseInt(req.params.accessId, 10);
    const userId = req.userId!;

    if (isNaN(hostId) || isNaN(accessId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    try {
      // Verify user owns the host
      const host = await db
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId)))
        .limit(1);

      if (host.length === 0) {
        return res.status(403).json({ error: "Not host owner" });
      }

      // Delete the access
      await db.delete(hostAccess).where(eq(hostAccess.id, accessId));

      databaseLogger.info("Revoked host access", {
        operation: "revoke_host_access",
        hostId,
        accessId,
        userId,
      });

      res.json({ success: true, message: "Access revoked" });
    } catch (error) {
      databaseLogger.error("Failed to revoke host access", error, {
        operation: "revoke_host_access",
        hostId,
        accessId,
        userId,
      });
      res.status(500).json({ error: "Failed to revoke access" });
    }
  },
);

/**
 * Get host access list
 * GET /rbac/host/:id/access
 */
router.get(
  "/host/:id/access",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const hostId = parseInt(req.params.id, 10);
    const userId = req.userId!;

    if (isNaN(hostId)) {
      return res.status(400).json({ error: "Invalid host ID" });
    }

    try {
      // Verify user owns the host
      const host = await db
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId)))
        .limit(1);

      if (host.length === 0) {
        return res.status(403).json({ error: "Not host owner" });
      }

      // Get all access records (both user and role based)
      const rawAccessList = await db
        .select({
          id: hostAccess.id,
          userId: hostAccess.userId,
          roleId: hostAccess.roleId,
          username: users.username,
          roleName: roles.name,
          roleDisplayName: roles.displayName,
          grantedBy: hostAccess.grantedBy,
          grantedByUsername: sql<string>`(SELECT username FROM users WHERE id = ${hostAccess.grantedBy})`,
          permissionLevel: hostAccess.permissionLevel,
          expiresAt: hostAccess.expiresAt,
          createdAt: hostAccess.createdAt,
          lastAccessedAt: hostAccess.lastAccessedAt,
          accessCount: hostAccess.accessCount,
        })
        .from(hostAccess)
        .leftJoin(users, eq(hostAccess.userId, users.id))
        .leftJoin(roles, eq(hostAccess.roleId, roles.id))
        .where(eq(hostAccess.hostId, hostId))
        .orderBy(desc(hostAccess.createdAt));

      // Format access list with type information
      const accessList = rawAccessList.map((access) => ({
        id: access.id,
        targetType: access.userId ? "user" : "role",
        userId: access.userId,
        roleId: access.roleId,
        username: access.username,
        roleName: access.roleName,
        roleDisplayName: access.roleDisplayName,
        grantedBy: access.grantedBy,
        grantedByUsername: access.grantedByUsername,
        permissionLevel: access.permissionLevel,
        expiresAt: access.expiresAt,
        createdAt: access.createdAt,
        lastAccessedAt: access.lastAccessedAt,
        accessCount: access.accessCount,
      }));

      res.json({ accessList });
    } catch (error) {
      databaseLogger.error("Failed to get host access list", error, {
        operation: "get_host_access_list",
        hostId,
        userId,
      });
      res.status(500).json({ error: "Failed to get access list" });
    }
  },
);

/**
 * Get user's shared hosts (hosts shared WITH this user)
 * GET /rbac/shared-hosts
 */
router.get(
  "/shared-hosts",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;

    try {
      const now = new Date().toISOString();

      const sharedHosts = await db
        .select({
          id: sshData.id,
          name: sshData.name,
          ip: sshData.ip,
          port: sshData.port,
          username: sshData.username,
          folder: sshData.folder,
          tags: sshData.tags,
          permissionLevel: hostAccess.permissionLevel,
          expiresAt: hostAccess.expiresAt,
          grantedBy: hostAccess.grantedBy,
          ownerUsername: users.username,
        })
        .from(hostAccess)
        .innerJoin(sshData, eq(hostAccess.hostId, sshData.id))
        .innerJoin(users, eq(sshData.userId, users.id))
        .where(
          and(
            eq(hostAccess.userId, userId),
            or(isNull(hostAccess.expiresAt), gte(hostAccess.expiresAt, now)),
          ),
        )
        .orderBy(desc(hostAccess.createdAt));

      res.json({ sharedHosts });
    } catch (error) {
      databaseLogger.error("Failed to get shared hosts", error, {
        operation: "get_shared_hosts",
        userId,
      });
      res.status(500).json({ error: "Failed to get shared hosts" });
    }
  },
);

/**
 * Get all roles
 * GET /rbac/roles
 */
router.get(
  "/roles",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const allRoles = await db
        .select()
        .from(roles)
        .orderBy(roles.isSystem, roles.name);

      const rolesWithParsedPermissions = allRoles.map((role) => ({
        ...role,
        permissions: JSON.parse(role.permissions),
      }));

      res.json({ roles: rolesWithParsedPermissions });
    } catch (error) {
      databaseLogger.error("Failed to get roles", error, {
        operation: "get_roles",
      });
      res.status(500).json({ error: "Failed to get roles" });
    }
  },
);

// ============================================================================
// Role Management (CRUD)
// ============================================================================

/**
 * Get all roles
 * GET /rbac/roles
 */
router.get(
  "/roles",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rolesList = await db
        .select({
          id: roles.id,
          name: roles.name,
          displayName: roles.displayName,
          description: roles.description,
          isSystem: roles.isSystem,
          createdAt: roles.createdAt,
          updatedAt: roles.updatedAt,
        })
        .from(roles)
        .orderBy(roles.isSystem, roles.name);

      res.json({ roles: rolesList });
    } catch (error) {
      databaseLogger.error("Failed to get roles", error, {
        operation: "get_roles",
      });
      res.status(500).json({ error: "Failed to get roles" });
    }
  },
);

/**
 * Create new role
 * POST /rbac/roles
 */
router.post(
  "/roles",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const { name, displayName, description } = req.body;

    // Validate required fields
    if (!isNonEmptyString(name) || !isNonEmptyString(displayName)) {
      return res.status(400).json({
        error: "Role name and display name are required",
      });
    }

    // Validate name format (alphanumeric, underscore, hyphen only)
    if (!/^[a-z0-9_-]+$/.test(name)) {
      return res.status(400).json({
        error:
          "Role name must contain only lowercase letters, numbers, underscores, and hyphens",
      });
    }

    try {
      // Check if role name already exists
      const existing = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, name))
        .limit(1);

      if (existing.length > 0) {
        return res.status(409).json({
          error: "A role with this name already exists",
        });
      }

      // Create new role
      const result = await db.insert(roles).values({
        name,
        displayName,
        description: description || null,
        isSystem: false,
        permissions: null, // Roles are for grouping only
      });

      const newRoleId = result.lastInsertRowid;

      databaseLogger.info("Created new role", {
        operation: "create_role",
        roleId: newRoleId,
        roleName: name,
      });

      res.status(201).json({
        success: true,
        roleId: newRoleId,
        message: "Role created successfully",
      });
    } catch (error) {
      databaseLogger.error("Failed to create role", error, {
        operation: "create_role",
        roleName: name,
      });
      res.status(500).json({ error: "Failed to create role" });
    }
  },
);

/**
 * Update role
 * PUT /rbac/roles/:id
 */
router.put(
  "/roles/:id",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const roleId = parseInt(req.params.id, 10);
    const { displayName, description } = req.body;

    if (isNaN(roleId)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    // Validate at least one field to update
    if (!displayName && description === undefined) {
      return res.status(400).json({
        error: "At least one field (displayName or description) is required",
      });
    }

    try {
      // Get existing role
      const existingRole = await db
        .select({
          id: roles.id,
          name: roles.name,
          isSystem: roles.isSystem,
        })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (existingRole.length === 0) {
        return res.status(404).json({ error: "Role not found" });
      }

      // Build update object
      const updates: {
        displayName?: string;
        description?: string | null;
        updatedAt: string;
      } = {
        updatedAt: new Date().toISOString(),
      };

      if (displayName) {
        updates.displayName = displayName;
      }

      if (description !== undefined) {
        updates.description = description || null;
      }

      // Update role
      await db.update(roles).set(updates).where(eq(roles.id, roleId));

      databaseLogger.info("Updated role", {
        operation: "update_role",
        roleId,
        roleName: existingRole[0].name,
      });

      res.json({
        success: true,
        message: "Role updated successfully",
      });
    } catch (error) {
      databaseLogger.error("Failed to update role", error, {
        operation: "update_role",
        roleId,
      });
      res.status(500).json({ error: "Failed to update role" });
    }
  },
);

/**
 * Delete role
 * DELETE /rbac/roles/:id
 */
router.delete(
  "/roles/:id",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const roleId = parseInt(req.params.id, 10);

    if (isNaN(roleId)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    try {
      // Get role details
      const role = await db
        .select({
          id: roles.id,
          name: roles.name,
          isSystem: roles.isSystem,
        })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (role.length === 0) {
        return res.status(404).json({ error: "Role not found" });
      }

      // Cannot delete system roles
      if (role[0].isSystem) {
        return res.status(403).json({
          error: "Cannot delete system roles",
        });
      }

      // Check if role is in use
      const usageCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(userRoles)
        .where(eq(userRoles.roleId, roleId));

      if (usageCount[0].count > 0) {
        return res.status(409).json({
          error: `Cannot delete role: ${usageCount[0].count} user(s) are assigned to this role`,
          usageCount: usageCount[0].count,
        });
      }

      // Check if role is used in host_access
      const hostAccessCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(hostAccess)
        .where(eq(hostAccess.roleId, roleId));

      if (hostAccessCount[0].count > 0) {
        return res.status(409).json({
          error: `Cannot delete role: ${hostAccessCount[0].count} host(s) are shared with this role`,
          hostAccessCount: hostAccessCount[0].count,
        });
      }

      // Delete role
      await db.delete(roles).where(eq(roles.id, roleId));

      databaseLogger.info("Deleted role", {
        operation: "delete_role",
        roleId,
        roleName: role[0].name,
      });

      res.json({
        success: true,
        message: "Role deleted successfully",
      });
    } catch (error) {
      databaseLogger.error("Failed to delete role", error, {
        operation: "delete_role",
        roleId,
      });
      res.status(500).json({ error: "Failed to delete role" });
    }
  },
);

// ============================================================================
// User-Role Assignment
// ============================================================================

/**
 * Assign role to user
 * POST /rbac/users/:userId/roles
 */
router.post(
  "/users/:userId/roles",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const targetUserId = req.params.userId;
    const currentUserId = req.userId!;

    try {
      const { roleId } = req.body;

      if (typeof roleId !== "number") {
        return res.status(400).json({ error: "Role ID is required" });
      }

      // Verify target user exists
      const targetUser = await db
        .select()
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      if (targetUser.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      // Verify role exists
      const role = await db
        .select()
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (role.length === 0) {
        return res.status(404).json({ error: "Role not found" });
      }

      // Prevent manual assignment of system roles
      if (role[0].isSystem) {
        return res.status(403).json({
          error:
            "System roles (admin, user) are automatically assigned and cannot be manually assigned",
        });
      }

      // Check if already assigned
      const existing = await db
        .select()
        .from(userRoles)
        .where(
          and(eq(userRoles.userId, targetUserId), eq(userRoles.roleId, roleId)),
        )
        .limit(1);

      if (existing.length > 0) {
        return res.status(409).json({ error: "Role already assigned" });
      }

      // Assign role
      await db.insert(userRoles).values({
        userId: targetUserId,
        roleId,
        grantedBy: currentUserId,
      });

      // Invalidate permission cache
      permissionManager.invalidateUserPermissionCache(targetUserId);

      databaseLogger.info("Assigned role to user", {
        operation: "assign_role",
        targetUserId,
        roleId,
        roleName: role[0].name,
        grantedBy: currentUserId,
      });

      res.json({
        success: true,
        message: "Role assigned successfully",
      });
    } catch (error) {
      databaseLogger.error("Failed to assign role", error, {
        operation: "assign_role",
        targetUserId,
      });
      res.status(500).json({ error: "Failed to assign role" });
    }
  },
);

/**
 * Remove role from user
 * DELETE /rbac/users/:userId/roles/:roleId
 */
router.delete(
  "/users/:userId/roles/:roleId",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const targetUserId = req.params.userId;
    const roleId = parseInt(req.params.roleId, 10);

    if (isNaN(roleId)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    try {
      // Verify role exists and get its details
      const role = await db
        .select({
          id: roles.id,
          name: roles.name,
          isSystem: roles.isSystem,
        })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (role.length === 0) {
        return res.status(404).json({ error: "Role not found" });
      }

      // Prevent removal of system roles
      if (role[0].isSystem) {
        return res.status(403).json({
          error:
            "System roles (admin, user) are automatically assigned and cannot be removed",
        });
      }

      // Delete the user-role assignment
      await db
        .delete(userRoles)
        .where(
          and(eq(userRoles.userId, targetUserId), eq(userRoles.roleId, roleId)),
        );

      // Invalidate permission cache
      permissionManager.invalidateUserPermissionCache(targetUserId);

      databaseLogger.info("Removed role from user", {
        operation: "remove_role",
        targetUserId,
        roleId,
      });

      res.json({
        success: true,
        message: "Role removed successfully",
      });
    } catch (error) {
      databaseLogger.error("Failed to remove role", error, {
        operation: "remove_role",
        targetUserId,
        roleId,
      });
      res.status(500).json({ error: "Failed to remove role" });
    }
  },
);

/**
 * Get user's roles
 * GET /rbac/users/:userId/roles
 */
router.get(
  "/users/:userId/roles",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const targetUserId = req.params.userId;
    const currentUserId = req.userId!;

    // Users can only see their own roles unless they're admin
    if (
      targetUserId !== currentUserId &&
      !(await permissionManager.isAdmin(currentUserId))
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      const userRolesList = await db
        .select({
          id: userRoles.id,
          roleId: roles.id,
          roleName: roles.name,
          roleDisplayName: roles.displayName,
          description: roles.description,
          isSystem: roles.isSystem,
          grantedAt: userRoles.grantedAt,
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, targetUserId));

      res.json({ roles: userRolesList });
    } catch (error) {
      databaseLogger.error("Failed to get user roles", error, {
        operation: "get_user_roles",
        targetUserId,
      });
      res.status(500).json({ error: "Failed to get user roles" });
    }
  },
);

export default router;
