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
  sharedCredentials,
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

//Share a host with a user or role
//POST /rbac/host/:id/share
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
        targetType = "user",
        targetUserId,
        targetRoleId,
        durationHours,
        permissionLevel = "view",
      } = req.body;

      if (!["user", "role"].includes(targetType)) {
        return res
          .status(400)
          .json({ error: "Invalid target type. Must be 'user' or 'role'" });
      }

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

      if (!host[0].credentialId) {
        return res.status(400).json({
          error:
            "Only hosts using credentials can be shared. Please create a credential and assign it to this host before sharing.",
          code: "CREDENTIAL_REQUIRED_FOR_SHARING",
        });
      }

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

      const validLevels = ["view"];
      if (!validLevels.includes(permissionLevel)) {
        return res.status(400).json({
          error: "Invalid permission level. Only 'view' is supported.",
          validLevels,
        });
      }

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
        await db
          .update(hostAccess)
          .set({
            permissionLevel,
            expiresAt,
          })
          .where(eq(hostAccess.id, existing[0].id));

        await db
          .delete(sharedCredentials)
          .where(eq(sharedCredentials.hostAccessId, existing[0].id));

        const { SharedCredentialManager } =
          await import("../../utils/shared-credential-manager.js");
        const sharedCredManager = SharedCredentialManager.getInstance();
        if (targetType === "user") {
          await sharedCredManager.createSharedCredentialForUser(
            existing[0].id,
            host[0].credentialId,
            targetUserId!,
            userId,
          );
        } else {
          await sharedCredManager.createSharedCredentialsForRole(
            existing[0].id,
            host[0].credentialId,
            targetRoleId!,
            userId,
          );
        }

        return res.json({
          success: true,
          message: "Host access updated",
          expiresAt,
        });
      }

      const result = await db.insert(hostAccess).values({
        hostId,
        userId: targetType === "user" ? targetUserId : null,
        roleId: targetType === "role" ? targetRoleId : null,
        grantedBy: userId,
        permissionLevel,
        expiresAt,
      });

      const { SharedCredentialManager } =
        await import("../../utils/shared-credential-manager.js");
      const sharedCredManager = SharedCredentialManager.getInstance();

      if (targetType === "user") {
        await sharedCredManager.createSharedCredentialForUser(
          result.lastInsertRowid as number,
          host[0].credentialId,
          targetUserId!,
          userId,
        );
      } else {
        await sharedCredManager.createSharedCredentialsForRole(
          result.lastInsertRowid as number,
          host[0].credentialId,
          targetRoleId!,
          userId,
        );
      }

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

// Revoke host access
// DELETE /rbac/host/:id/access/:accessId
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
      const host = await db
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId)))
        .limit(1);

      if (host.length === 0) {
        return res.status(403).json({ error: "Not host owner" });
      }

      await db.delete(hostAccess).where(eq(hostAccess.id, accessId));

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

// Get host access list
// GET /rbac/host/:id/access
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
      const host = await db
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId)))
        .limit(1);

      if (host.length === 0) {
        return res.status(403).json({ error: "Not host owner" });
      }

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
        })
        .from(hostAccess)
        .leftJoin(users, eq(hostAccess.userId, users.id))
        .leftJoin(roles, eq(hostAccess.roleId, roles.id))
        .where(eq(hostAccess.hostId, hostId))
        .orderBy(desc(hostAccess.createdAt));

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

// Get user's shared hosts (hosts shared WITH this user)
// GET /rbac/shared-hosts
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

// Get all roles
// GET /rbac/roles
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

// Get all roles
// GET /rbac/roles
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

// Create new role
// POST /rbac/roles
router.post(
  "/roles",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const { name, displayName, description } = req.body;

    if (!isNonEmptyString(name) || !isNonEmptyString(displayName)) {
      return res.status(400).json({
        error: "Role name and display name are required",
      });
    }

    if (!/^[a-z0-9_-]+$/.test(name)) {
      return res.status(400).json({
        error:
          "Role name must contain only lowercase letters, numbers, underscores, and hyphens",
      });
    }

    try {
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

      const result = await db.insert(roles).values({
        name,
        displayName,
        description: description || null,
        isSystem: false,
        permissions: null,
      });

      const newRoleId = result.lastInsertRowid;

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

// Update role
// PUT /rbac/roles/:id
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

    if (!displayName && description === undefined) {
      return res.status(400).json({
        error: "At least one field (displayName or description) is required",
      });
    }

    try {
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

      await db.update(roles).set(updates).where(eq(roles.id, roleId));

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

// Delete role
// DELETE /rbac/roles/:id
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

      if (role[0].isSystem) {
        return res.status(403).json({
          error: "Cannot delete system roles",
        });
      }

      const deletedUserRoles = await db
        .delete(userRoles)
        .where(eq(userRoles.roleId, roleId))
        .returning({ userId: userRoles.userId });

      for (const { userId } of deletedUserRoles) {
        permissionManager.invalidateUserPermissionCache(userId);
      }

      const deletedHostAccess = await db
        .delete(hostAccess)
        .where(eq(hostAccess.roleId, roleId))
        .returning({ id: hostAccess.id });

      await db.delete(roles).where(eq(roles.id, roleId));

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

// Assign role to user
// POST /rbac/users/:userId/roles
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

      const targetUser = await db
        .select()
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      if (targetUser.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const role = await db
        .select()
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (role.length === 0) {
        return res.status(404).json({ error: "Role not found" });
      }

      if (role[0].isSystem) {
        return res.status(403).json({
          error:
            "System roles (admin, user) are automatically assigned and cannot be manually assigned",
        });
      }

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

      await db.insert(userRoles).values({
        userId: targetUserId,
        roleId,
        grantedBy: currentUserId,
      });

      const hostsSharedWithRole = await db
        .select()
        .from(hostAccess)
        .innerJoin(sshData, eq(hostAccess.hostId, sshData.id))
        .where(eq(hostAccess.roleId, roleId));

      const { SharedCredentialManager } =
        await import("../../utils/shared-credential-manager.js");
      const sharedCredManager = SharedCredentialManager.getInstance();

      for (const { host_access, ssh_data } of hostsSharedWithRole) {
        if (ssh_data.credentialId) {
          try {
            await sharedCredManager.createSharedCredentialForUser(
              host_access.id,
              ssh_data.credentialId,
              targetUserId,
              ssh_data.userId,
            );
          } catch (error) {
            databaseLogger.error(
              "Failed to create shared credential for new role member",
              error,
              {
                operation: "assign_role_create_credentials",
                targetUserId,
                roleId,
                hostId: ssh_data.id,
              },
            );
          }
        }
      }

      permissionManager.invalidateUserPermissionCache(targetUserId);

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

// Remove role from user
// DELETE /rbac/users/:userId/roles/:roleId
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

      if (role[0].isSystem) {
        return res.status(403).json({
          error:
            "System roles (admin, user) are automatically assigned and cannot be removed",
        });
      }

      await db
        .delete(userRoles)
        .where(
          and(eq(userRoles.userId, targetUserId), eq(userRoles.roleId, roleId)),
        );

      permissionManager.invalidateUserPermissionCache(targetUserId);

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

// Get user's roles
// GET /rbac/users/:userId/roles
router.get(
  "/users/:userId/roles",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const targetUserId = req.params.userId;
    const currentUserId = req.userId!;

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
