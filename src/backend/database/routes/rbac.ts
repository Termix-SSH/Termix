import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { hosts, snippets, sshCredentials } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { createCurrentRbacAccessRepository } from "../repositories/current-rbac-access-repository.js";
import { createCurrentRoleRepository } from "../repositories/current-role-repository.js";
import { createCurrentUserRepository } from "../repositories/current-user-repository.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();

const authenticateJWT = authManager.createAuthMiddleware();

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @openapi
 * /rbac/host/{id}/share:
 *   post:
 *     summary: Share a host
 *     description: Shares a host with a user or a role.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetType:
 *                 type: string
 *                 enum: [user, role]
 *               targetUserId:
 *                 type: string
 *               targetRoleId:
 *                 type: integer
 *               durationHours:
 *                 type: number
 *               permissionLevel:
 *                 type: string
 *                 enum: [view]
 *     responses:
 *       200:
 *         description: Host shared successfully.
 *       400:
 *         description: Invalid request body.
 *       403:
 *         description: Not host owner.
 *       404:
 *         description: Target user or role not found.
 *       500:
 *         description: Failed to share host.
 */
router.post(
  "/host/:id/share",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const hostId = parseInt(id, 10);
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
        .from(hosts)
        .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
        .limit(1);

      if (host.length === 0) {
        databaseLogger.warn("Permission denied", {
          operation: "rbac_permission_denied",
          userId,
          resource: "host",
          resourceId: hostId,
          action: "share",
        });
        return res.status(403).json({ error: "Not host owner" });
      }

      if (
        !host[0].credentialId &&
        !host[0].rdpCredentialId &&
        !host[0].vncCredentialId &&
        host[0].authType !== "opkssh"
      ) {
        return res.status(400).json({
          error:
            "Only hosts using credentials or OPKSSH can be shared. Please create a credential and assign it to this host before sharing.",
          code: "CREDENTIAL_REQUIRED_FOR_SHARING",
        });
      }

      if (targetType === "user") {
        const targetUser =
          await createCurrentUserRepository().findById(targetUserId);

        if (!targetUser) {
          return res.status(404).json({ error: "Target user not found" });
        }
      } else {
        const targetRole =
          await createCurrentRoleRepository().findRoleById(targetRoleId);

        if (!targetRole) {
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

      const accessGrant =
        await createCurrentRbacAccessRepository().upsertHostAccess({
          hostId,
          grantedBy: userId,
          permissionLevel,
          expiresAt,
          ...(targetType === "user"
            ? { targetType: "user" as const, targetUserId: targetUserId! }
            : { targetType: "role" as const, targetRoleId: targetRoleId! }),
        });

      if (!accessGrant.created) {
        const activeCredentialId =
          host[0].credentialId ??
          host[0].rdpCredentialId ??
          host[0].vncCredentialId;
        if (activeCredentialId) {
          const { SharedCredentialManager } =
            await import("../../utils/shared-credential-manager.js");
          const sharedCredManager = SharedCredentialManager.getInstance();
          if (targetType === "user") {
            await sharedCredManager.createSharedCredentialForUser(
              accessGrant.id,
              activeCredentialId,
              targetUserId!,
              userId,
            );
          } else {
            await sharedCredManager.createSharedCredentialsForRole(
              accessGrant.id,
              activeCredentialId,
              targetRoleId!,
              userId,
            );
          }
        }
        databaseLogger.info("Permission granted", {
          operation: "rbac_permission_grant",
          adminId: userId,
          hostId,
          resource: "host",
          action: "view",
        });

        return res.json({
          success: true,
          message: "Host access updated",
          expiresAt,
        });
      }

      const { SharedCredentialManager } =
        await import("../../utils/shared-credential-manager.js");
      const sharedCredManager = SharedCredentialManager.getInstance();

      const activeCredentialId =
        host[0].credentialId ??
        host[0].rdpCredentialId ??
        host[0].vncCredentialId;
      if (activeCredentialId) {
        if (targetType === "user") {
          await sharedCredManager.createSharedCredentialForUser(
            accessGrant.id,
            activeCredentialId,
            targetUserId!,
            userId,
          );
        } else {
          await sharedCredManager.createSharedCredentialsForRole(
            accessGrant.id,
            activeCredentialId,
            targetRoleId!,
            userId,
          );
        }
      }
      databaseLogger.success("Host shared successfully", {
        operation: "rbac_host_share_success",
        userId,
        hostId,
        targetUserId: targetType === "user" ? targetUserId : undefined,
        permissionLevel,
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
 * @openapi
 * /rbac/host/{id}/access/{accessId}:
 *   delete:
 *     summary: Revoke host access
 *     description: Revokes a user's or role's access to a host.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: accessId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Access revoked successfully.
 *       400:
 *         description: Invalid ID.
 *       403:
 *         description: Not host owner.
 *       500:
 *         description: Failed to revoke access.
 */
router.delete(
  "/host/:id/access/:accessId",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const accessIdParam = Array.isArray(req.params.accessId)
      ? req.params.accessId[0]
      : req.params.accessId;
    const hostId = parseInt(id, 10);
    const accessId = parseInt(accessIdParam, 10);
    const userId = req.userId!;

    if (isNaN(hostId) || isNaN(accessId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    try {
      const host = await db
        .select()
        .from(hosts)
        .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
        .limit(1);

      if (host.length === 0) {
        return res.status(403).json({ error: "Not host owner" });
      }

      await createCurrentRbacAccessRepository().revokeHostAccess(accessId);
      databaseLogger.info("Permission revoked", {
        operation: "rbac_permission_revoke",
        adminId: userId,
        hostId,
        accessId,
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
 * @openapi
 * /rbac/host/{id}/access:
 *   get:
 *     summary: Get host access list
 *     description: Retrieves the list of users and roles that have access to a host.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The access list for the host.
 *       400:
 *         description: Invalid host ID.
 *       403:
 *         description: Not host owner.
 *       500:
 *         description: Failed to get access list.
 */
router.get(
  "/host/:id/access",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const hostId = parseInt(id, 10);
    const userId = req.userId!;

    if (isNaN(hostId)) {
      return res.status(400).json({ error: "Invalid host ID" });
    }

    try {
      const host = await db
        .select()
        .from(hosts)
        .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
        .limit(1);

      if (host.length === 0) {
        return res.status(403).json({ error: "Not host owner" });
      }

      const accessList =
        await createCurrentRbacAccessRepository().listHostAccess(hostId);

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
 * @openapi
 * /rbac/shared-hosts:
 *   get:
 *     summary: Get shared hosts
 *     description: Retrieves the list of hosts that have been shared with the authenticated user.
 *     tags:
 *       - RBAC
 *     responses:
 *       200:
 *         description: A list of shared hosts.
 *       500:
 *         description: Failed to get shared hosts.
 */
router.get(
  "/shared-hosts",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;

    try {
      const roleIds =
        await createCurrentRoleRepository().listUserRoleIds(userId);
      const sharedHosts =
        await createCurrentRbacAccessRepository().listSharedHosts(
          userId,
          roleIds,
        );

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
 * @openapi
 * /rbac/roles:
 *   get:
 *     summary: Get all roles
 *     description: Retrieves a list of all roles.
 *     tags:
 *       - RBAC
 *     responses:
 *       200:
 *         description: A list of roles.
 *       500:
 *         description: Failed to get roles.
 */
router.get(
  "/roles",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rolesList = (await createCurrentRoleRepository().listRoles()).map(
        ({
          id,
          name,
          displayName,
          description,
          isSystem,
          createdAt,
          updatedAt,
        }) => ({
          id,
          name,
          displayName,
          description,
          isSystem,
          createdAt,
          updatedAt,
        }),
      );

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
 * @openapi
 * /rbac/roles:
 *   post:
 *     summary: Create a new role
 *     description: Creates a new role.
 *     tags:
 *       - RBAC
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               displayName:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Role created successfully.
 *       400:
 *         description: Invalid request body.
 *       409:
 *         description: A role with this name already exists.
 *       500:
 *         description: Failed to create role.
 */
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
      const existing = await createCurrentRoleRepository().findRoleByName(name);

      if (existing) {
        return res.status(409).json({
          error: "A role with this name already exists",
        });
      }

      const newRoleId = await createCurrentRoleRepository().createRole({
        name,
        displayName,
        description: description || null,
        isSystem: false,
        permissions: null,
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
 * @openapi
 * /rbac/roles/{id}:
 *   put:
 *     summary: Update a role
 *     description: Updates a role by its ID.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Role updated successfully.
 *       400:
 *         description: Invalid request body or role ID.
 *       404:
 *         description: Role not found.
 *       500:
 *         description: Failed to update role.
 */
router.put(
  "/roles/:id",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const roleId = parseInt(id, 10);
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
      const existingRole =
        await createCurrentRoleRepository().findRoleById(roleId);

      if (!existingRole) {
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

      await createCurrentRoleRepository().updateRole(roleId, updates);

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
 * @openapi
 * /rbac/roles/{id}:
 *   delete:
 *     summary: Delete a role
 *     description: Deletes a role by its ID.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Role deleted successfully.
 *       400:
 *         description: Invalid role ID.
 *       403:
 *         description: Cannot delete system roles.
 *       404:
 *         description: Role not found.
 *       500:
 *         description: Failed to delete role.
 */
router.delete(
  "/roles/:id",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const roleId = parseInt(id, 10);

    if (isNaN(roleId)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    try {
      const role = await createCurrentRoleRepository().findRoleById(roleId);

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      if (role.isSystem) {
        return res.status(403).json({
          error: "Cannot delete system roles",
        });
      }

      const { deletedUserIds } =
        await createCurrentRoleRepository().deleteRole(roleId);

      for (const userId of deletedUserIds) {
        permissionManager.invalidateUserPermissionCache(userId);
      }

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

/**
 * @openapi
 * /rbac/users/{userId}/roles:
 *   post:
 *     summary: Assign a role to a user
 *     description: Assigns a role to a user.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               roleId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Role assigned successfully.
 *       400:
 *         description: Role ID is required.
 *       403:
 *         description: System roles cannot be manually assigned.
 *       404:
 *         description: User or role not found.
 *       409:
 *         description: Role already assigned.
 *       500:
 *         description: Failed to assign role.
 */
router.post(
  "/users/:userId/roles",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const targetUserId = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;
    const currentUserId = req.userId!;

    try {
      const { roleId } = req.body;

      if (typeof roleId !== "number") {
        return res.status(400).json({ error: "Role ID is required" });
      }

      const targetUser =
        await createCurrentUserRepository().findById(targetUserId);

      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const role = await createCurrentRoleRepository().findRoleById(roleId);

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      if (role.isSystem) {
        return res.status(403).json({
          error:
            "System roles (admin, user) are automatically assigned and cannot be manually assigned",
        });
      }

      const existing = await createCurrentRoleRepository().findUserRole(
        targetUserId,
        roleId,
      );

      if (existing) {
        return res.status(409).json({ error: "Role already assigned" });
      }

      await createCurrentRoleRepository().assignRoleToUser({
        userId: targetUserId,
        roleId,
        grantedBy: currentUserId,
      });

      const hostsSharedWithRole =
        await createCurrentRbacAccessRepository().listRoleHostAccessCredentialSources(
          roleId,
        );

      const { SharedCredentialManager } =
        await import("../../utils/shared-credential-manager.js");
      const sharedCredManager = SharedCredentialManager.getInstance();

      for (const sharedHost of hostsSharedWithRole) {
        if (sharedHost.credentialId) {
          try {
            await sharedCredManager.createSharedCredentialForUser(
              sharedHost.hostAccessId,
              sharedHost.credentialId,
              targetUserId,
              sharedHost.hostOwnerId,
            );
          } catch (error) {
            databaseLogger.error(
              "Failed to create shared credential for new role member",
              error,
              {
                operation: "assign_role_create_credentials",
                targetUserId,
                roleId,
                hostId: sharedHost.hostId,
              },
            );
          }
        }
      }

      permissionManager.invalidateUserPermissionCache(targetUserId);
      databaseLogger.info("Role assigned to user", {
        operation: "rbac_role_assign",
        adminId: currentUserId,
        targetUserId,
        roleId,
        roleName: role.name,
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
 * @openapi
 * /rbac/users/{userId}/roles/{roleId}:
 *   delete:
 *     summary: Remove a role from a user
 *     description: Removes a role from a user.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Role removed successfully.
 *       400:
 *         description: Invalid role ID.
 *       403:
 *         description: System roles cannot be removed.
 *       404:
 *         description: Role not found.
 *       500:
 *         description: Failed to remove role.
 */
router.delete(
  "/users/:userId/roles/:roleId",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const targetUserId = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;
    const roleIdParam = Array.isArray(req.params.roleId)
      ? req.params.roleId[0]
      : req.params.roleId;
    const roleId = parseInt(roleIdParam, 10);

    if (isNaN(roleId)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    try {
      const role = await createCurrentRoleRepository().findRoleById(roleId);

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      if (role.isSystem) {
        return res.status(403).json({
          error:
            "System roles (admin, user) are automatically assigned and cannot be removed",
        });
      }

      await createCurrentRoleRepository().removeRoleFromUser(
        targetUserId,
        roleId,
      );

      permissionManager.invalidateUserPermissionCache(targetUserId);
      databaseLogger.info("Role removed from user", {
        operation: "rbac_role_remove",
        adminId: req.userId!,
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
 * @openapi
 * /rbac/users/{userId}/roles:
 *   get:
 *     summary: Get user's roles
 *     description: Retrieves a list of roles for a specific user.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A list of roles.
 *       403:
 *         description: Access denied.
 *       500:
 *         description: Failed to get user roles.
 */
router.get(
  "/users/:userId/roles",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const targetUserId = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;
    const currentUserId = req.userId!;

    if (
      targetUserId !== currentUserId &&
      !(await permissionManager.isAdmin(currentUserId))
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      const userRolesList =
        await createCurrentRoleRepository().listUserRoles(targetUserId);

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

// ============================================================================
// SNIPPET SHARING
// ============================================================================

/**
 * @openapi
 * /rbac/snippet/{id}/share:
 *   post:
 *     summary: Share a snippet
 *     description: Shares a snippet with a user or role.
 *     tags:
 *       - RBAC
 */
router.post(
  "/snippet/:id/share",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const snippetId = parseInt(id, 10);
    const userId = req.userId!;

    if (isNaN(snippetId)) {
      return res.status(400).json({ error: "Invalid snippet ID" });
    }

    try {
      const {
        targetType = "user",
        targetUserId,
        targetRoleId,
        durationHours,
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

      const snippet = await db
        .select()
        .from(snippets)
        .where(and(eq(snippets.id, snippetId), eq(snippets.userId, userId)))
        .limit(1);

      if (snippet.length === 0) {
        return res.status(403).json({ error: "Not snippet owner" });
      }

      if (targetType === "user") {
        const targetUser =
          await createCurrentUserRepository().findById(targetUserId);
        if (!targetUser) {
          return res.status(404).json({ error: "Target user not found" });
        }
      } else {
        const targetRole =
          await createCurrentRoleRepository().findRoleById(targetRoleId);
        if (!targetRole) {
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

      const accessGrant =
        await createCurrentRbacAccessRepository().upsertSnippetAccess({
          snippetId,
          grantedBy: userId,
          expiresAt,
          ...(targetType === "user"
            ? { targetType: "user" as const, targetUserId: targetUserId! }
            : { targetType: "role" as const, targetRoleId: targetRoleId! }),
        });

      if (!accessGrant.created) {
        return res.json({
          success: true,
          message: "Snippet access updated",
          expiresAt,
        });
      }

      databaseLogger.success("Snippet shared successfully", {
        operation: "rbac_snippet_share",
        userId,
      });

      res.json({
        success: true,
        message: `Snippet shared successfully with ${targetType}`,
        expiresAt,
      });
    } catch (error) {
      databaseLogger.error("Failed to share snippet", error, {
        operation: "share_snippet",
        userId,
      });
      res.status(500).json({ error: "Failed to share snippet" });
    }
  },
);

/**
 * @openapi
 * /rbac/snippet/{id}/access/{accessId}:
 *   delete:
 *     summary: Revoke snippet access
 *     description: Revokes a user's or role's access to a snippet.
 *     tags:
 *       - RBAC
 */
router.delete(
  "/snippet/:id/access/:accessId",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const accessIdParam = Array.isArray(req.params.accessId)
      ? req.params.accessId[0]
      : req.params.accessId;
    const snippetId = parseInt(id, 10);
    const accessId = parseInt(accessIdParam, 10);
    const userId = req.userId!;

    if (isNaN(snippetId) || isNaN(accessId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    try {
      const snippet = await db
        .select()
        .from(snippets)
        .where(and(eq(snippets.id, snippetId), eq(snippets.userId, userId)))
        .limit(1);

      if (snippet.length === 0) {
        return res.status(403).json({ error: "Not snippet owner" });
      }

      await createCurrentRbacAccessRepository().revokeSnippetAccess(accessId);

      res.json({ success: true, message: "Snippet access revoked" });
    } catch (error) {
      databaseLogger.error("Failed to revoke snippet access", error, {
        operation: "revoke_snippet_access",
        userId,
      });
      res.status(500).json({ error: "Failed to revoke access" });
    }
  },
);

/**
 * @openapi
 * /rbac/snippet/{id}/access:
 *   get:
 *     summary: Get snippet access list
 *     description: Retrieves the list of users and roles with access to a snippet.
 *     tags:
 *       - RBAC
 */
router.get(
  "/snippet/:id/access",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const snippetId = parseInt(id, 10);
    const userId = req.userId!;

    if (isNaN(snippetId)) {
      return res.status(400).json({ error: "Invalid snippet ID" });
    }

    try {
      const snippet = await db
        .select()
        .from(snippets)
        .where(and(eq(snippets.id, snippetId), eq(snippets.userId, userId)))
        .limit(1);

      if (snippet.length === 0) {
        return res.status(403).json({ error: "Not snippet owner" });
      }

      const accessList =
        await createCurrentRbacAccessRepository().listSnippetAccess(snippetId);

      res.json({ accessList });
    } catch (error) {
      databaseLogger.error("Failed to get snippet access list", error, {
        operation: "get_snippet_access_list",
        userId,
      });
      res.status(500).json({ error: "Failed to get access list" });
    }
  },
);

/**
 * @openapi
 * /rbac/shared-snippets:
 *   get:
 *     summary: Get shared snippets
 *     description: Retrieves snippets shared with the current user.
 *     tags:
 *       - RBAC
 */
router.get(
  "/shared-snippets",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;

    try {
      const roleIds =
        await createCurrentRoleRepository().listUserRoleIds(userId);
      const sharedSnippets =
        await createCurrentRbacAccessRepository().listSharedSnippets(
          userId,
          roleIds,
        );

      res.json({ sharedSnippets });
    } catch (error) {
      databaseLogger.error("Failed to get shared snippets", error, {
        operation: "get_shared_snippets",
        userId,
      });
      res.status(500).json({ error: "Failed to get shared snippets" });
    }
  },
);

router.put(
  "/host-access/:hostId/credential",
  async (req: express.Request, res: express.Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId!;
      const hostId = Number.parseInt(String(req.params.hostId), 10);
      const { credentialId } = req.body;

      if (!hostId || isNaN(hostId)) {
        return res.status(400).json({ error: "Invalid host ID" });
      }

      const access =
        await createCurrentRbacAccessRepository().findDirectHostAccess(
          hostId,
          userId,
        );

      if (!access) {
        return res.status(403).json({ error: "No access to this host" });
      }

      if (credentialId) {
        const cred = await db
          .select({ id: sshCredentials.id })
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, credentialId),
              eq(sshCredentials.userId, userId),
            ),
          )
          .limit(1);

        if (cred.length === 0) {
          return res.status(404).json({ error: "Credential not found" });
        }
      }

      await createCurrentRbacAccessRepository().updateHostAccessOverrideCredential(
        access.id,
        credentialId || null,
      );

      res.json({ success: true });
    } catch (error) {
      databaseLogger.error("Failed to set override credential", error);
      res.status(500).json({ error: "Failed to update credential" });
    }
  },
);

export default router;
