import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import {
  sshCredentials,
  sshCredentialUsage,
  hosts,
  hostAccess,
} from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { authLogger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { parseSSHKey } from "../../utils/ssh-key-utils.js";
import { registerCredentialKeyRoutes } from "./credential-key-routes.js";
import { registerCredentialDeployRoutes } from "./credential-deploy-routes.js";

const router = express.Router();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

/**
 * @openapi
 * /credentials:
 *   post:
 *     summary: Create a new credential
 *     description: Creates a new SSH credential for the authenticated user.
 *     tags:
 *       - Credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               folder:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               authType:
 *                 type: string
 *                 enum: [password, key]
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               key:
 *                 type: string
 *               keyPassword:
 *                 type: string
 *               keyType:
 *                 type: string
 *     responses:
 *       201:
 *         description: Credential created successfully.
 *       400:
 *         description: Invalid request body.
 *       500:
 *         description: Failed to create credential.
 */
router.post(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const {
      name,
      description,
      folder,
      tags,
      authType,
      username,
      password,
      key,
      keyPassword,
      keyType,
      certPublicKey,
    } = req.body;

    if (!isNonEmptyString(userId) || !isNonEmptyString(name)) {
      authLogger.warn("Invalid credential creation data validation failed", {
        operation: "credential_create",
        userId,
        hasName: !!name,
      });
      return res.status(400).json({ error: "Name is required" });
    }

    if (!["password", "key"].includes(authType)) {
      authLogger.warn("Invalid auth type provided", {
        operation: "credential_create",
        userId,
        name,
        authType,
      });
      return res
        .status(400)
        .json({ error: 'Auth type must be "password" or "key"' });
    }

    try {
      if (authType === "password" && !password) {
        authLogger.warn("Password required for password authentication", {
          operation: "credential_create",
          userId,
          name,
          authType,
        });
        return res
          .status(400)
          .json({ error: "Password is required for password authentication" });
      }
      if (authType === "key" && !key) {
        authLogger.warn("SSH key required for key authentication", {
          operation: "credential_create",
          userId,
          name,
          authType,
        });
        return res
          .status(400)
          .json({ error: "SSH key is required for key authentication" });
      }
      const plainPassword =
        authType === "password" && password ? password : null;
      const plainKey = authType === "key" && key ? key : null;
      const plainKeyPassword =
        authType === "key" && keyPassword ? keyPassword : null;

      let keyInfo = null;
      if (authType === "key" && plainKey) {
        keyInfo = parseSSHKey(plainKey, plainKeyPassword);
        if (!keyInfo.success) {
          authLogger.warn("SSH key parsing failed", {
            operation: "credential_create",
            userId,
            name,
            error: keyInfo.error,
          });
          return res.status(400).json({
            error: `Invalid SSH key: ${keyInfo.error}`,
          });
        }
      }

      const credentialData = {
        userId,
        name: name.trim(),
        description: description?.trim() || null,
        folder: folder?.trim() || null,
        tags: Array.isArray(tags) ? tags.join(",") : tags || "",
        authType,
        username: username?.trim() || null,
        password: plainPassword,
        key: plainKey,
        privateKey: keyInfo?.privateKey || plainKey,
        publicKey: keyInfo?.publicKey || null,
        keyPassword: plainKeyPassword,
        keyType: keyType || null,
        detectedKeyType: keyInfo?.keyType || null,
        certPublicKey:
          authType === "key" && certPublicKey ? certPublicKey.trim() : null,
        usageCount: 0,
        lastUsed: null,
      };

      const created = (await SimpleDBOps.insert(
        sshCredentials,
        "ssh_credentials",
        credentialData,
        userId,
      )) as typeof credentialData & { id: number };

      authLogger.success(
        `SSH credential created: ${name} (${authType}) by user ${userId}`,
        {
          operation: "credential_create_success",
          userId,
          credentialId: created.id,
          name,
          authType,
          username,
        },
      );

      res.status(201).json(formatCredentialOutput(created));
    } catch (err) {
      authLogger.error("Failed to create credential in database", err, {
        operation: "credential_create",
        userId,
        name,
        authType,
        username,
      });
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to create credential",
      });
    }
  },
);

/**
 * @openapi
 * /credentials:
 *   get:
 *     summary: Get all credentials
 *     description: Retrieves all SSH credentials for the authenticated user.
 *     tags:
 *       - Credentials
 *     responses:
 *       200:
 *         description: A list of credentials.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to fetch credentials.
 */
router.get(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for credential fetch");
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const credentials = await SimpleDBOps.select(
        db
          .select()
          .from(sshCredentials)
          .where(eq(sshCredentials.userId, userId))
          .orderBy(desc(sshCredentials.updatedAt)),
        "ssh_credentials",
        userId,
      );

      res.json(credentials.map((cred) => formatCredentialOutput(cred)));
    } catch (err) {
      authLogger.error("Failed to fetch credentials", err);
      res.status(500).json({ error: "Failed to fetch credentials" });
    }
  },
);

/**
 * @openapi
 * /credentials/folders:
 *   get:
 *     summary: Get credential folders
 *     description: Retrieves all unique credential folders for the authenticated user.
 *     tags:
 *       - Credentials
 *     responses:
 *       200:
 *         description: A list of folder names.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to fetch credential folders.
 */
router.get(
  "/folders",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for credential folder fetch");
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const result = await db
        .select({ folder: sshCredentials.folder })
        .from(sshCredentials)
        .where(eq(sshCredentials.userId, userId));

      const folderCounts: Record<string, number> = {};
      result.forEach((r) => {
        if (r.folder && r.folder.trim() !== "") {
          folderCounts[r.folder] = (folderCounts[r.folder] || 0) + 1;
        }
      });

      const folders = Object.keys(folderCounts).filter(
        (folder) => folderCounts[folder] > 0,
      );
      res.json(folders);
    } catch (err) {
      authLogger.error("Failed to fetch credential folders", err);
      res.status(500).json({ error: "Failed to fetch credential folders" });
    }
  },
);

/**
 * @openapi
 * /credentials/{id}:
 *   get:
 *     summary: Get a specific credential
 *     description: Retrieves a specific credential by its ID, including secrets.
 *     tags:
 *       - Credentials
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The requested credential.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Credential not found.
 *       500:
 *         description: Failed to fetch credential.
 */
router.get(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for credential fetch");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const credentials = await SimpleDBOps.select(
        db
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, parseInt(id)),
              eq(sshCredentials.userId, userId),
            ),
          ),
        "ssh_credentials",
        userId,
      );

      if (credentials.length === 0) {
        return res.status(404).json({ error: "Credential not found" });
      }

      const credential = credentials[0];
      const output = formatCredentialOutput(credential);

      if (credential.password) {
        output.password = credential.password;
      }
      output.hasKey = !!credential.key;
      output.hasKeyPassword = !!credential.keyPassword;
      if (credential.publicKey) {
        output.publicKey = credential.publicKey;
      }
      if (credential.certPublicKey) {
        output.certPublicKey = credential.certPublicKey;
      }
      if (credential.keyPassword) {
        output.keyPassword = credential.keyPassword;
      }

      res.json(output);
    } catch (err) {
      authLogger.error("Failed to fetch credential", err);
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to fetch credential",
      });
    }
  },
);

/**
 * @openapi
 * /credentials/{id}:
 *   put:
 *     summary: Update a credential
 *     description: Updates a specific credential by its ID.
 *     tags:
 *       - Credentials
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
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: The updated credential.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Credential not found.
 *       500:
 *         description: Failed to update credential.
 */
router.put(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updateData = req.body;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for credential update");
      return res.status(400).json({ error: "Invalid request" });
    }
    authLogger.info("Updating SSH credential", {
      operation: "credential_update",
      userId,
      credentialId: parseInt(id),
      changes: Object.keys(updateData),
    });

    try {
      const existing = await db
        .select()
        .from(sshCredentials)
        .where(
          and(
            eq(sshCredentials.id, parseInt(id)),
            eq(sshCredentials.userId, userId),
          ),
        );

      if (existing.length === 0) {
        return res.status(404).json({ error: "Credential not found" });
      }

      const updateFields: Record<string, string | null | undefined> = {};

      if (updateData.name !== undefined)
        updateFields.name = updateData.name.trim();
      if (updateData.description !== undefined)
        updateFields.description = updateData.description?.trim() || null;
      if (updateData.folder !== undefined)
        updateFields.folder = updateData.folder?.trim() || null;
      if (updateData.tags !== undefined) {
        updateFields.tags = Array.isArray(updateData.tags)
          ? updateData.tags.join(",")
          : updateData.tags || "";
      }
      if (updateData.username !== undefined)
        updateFields.username = updateData.username?.trim() || null;
      if (updateData.authType !== undefined)
        updateFields.authType = updateData.authType;
      if (updateData.keyType !== undefined)
        updateFields.keyType = updateData.keyType;

      if (updateData.password !== undefined) {
        updateFields.password = updateData.password || null;
      }
      if (updateData.key !== undefined) {
        updateFields.key = updateData.key || null;

        if (updateData.key && existing[0].authType === "key") {
          const keyInfo = parseSSHKey(updateData.key, updateData.keyPassword);
          if (!keyInfo.success) {
            authLogger.warn("SSH key parsing failed during update", {
              operation: "credential_update",
              userId,
              credentialId: parseInt(id),
              error: keyInfo.error,
            });
            return res.status(400).json({
              error: `Invalid SSH key: ${keyInfo.error}`,
            });
          }
          updateFields.privateKey = keyInfo.privateKey;
          updateFields.publicKey = keyInfo.publicKey;
          updateFields.detectedKeyType = keyInfo.keyType;
        }
      }
      if (updateData.keyPassword !== undefined) {
        updateFields.keyPassword = updateData.keyPassword || null;
      }
      if (updateData.certPublicKey !== undefined) {
        updateFields.certPublicKey = updateData.certPublicKey?.trim() || null;
      }

      if (Object.keys(updateFields).length === 0) {
        const existing = await SimpleDBOps.select(
          db
            .select()
            .from(sshCredentials)
            .where(eq(sshCredentials.id, parseInt(id))),
          "ssh_credentials",
          userId,
        );

        return res.json(formatCredentialOutput(existing[0]));
      }

      await SimpleDBOps.update(
        sshCredentials,
        "ssh_credentials",
        and(
          eq(sshCredentials.id, parseInt(id)),
          eq(sshCredentials.userId, userId),
        ),
        updateFields,
        userId,
      );

      const updated = await SimpleDBOps.select(
        db
          .select()
          .from(sshCredentials)
          .where(eq(sshCredentials.id, parseInt(id))),
        "ssh_credentials",
        userId,
      );

      const { SharedCredentialManager } =
        await import("../../utils/shared-credential-manager.js");
      const sharedCredManager = SharedCredentialManager.getInstance();
      await sharedCredManager.updateSharedCredentialsForOriginal(
        parseInt(id),
        userId,
      );

      authLogger.success("SSH credential updated", {
        operation: "credential_update_success",
        userId,
        credentialId: parseInt(id),
      });

      res.json(formatCredentialOutput(updated[0]));
    } catch (err) {
      authLogger.error("Failed to update credential", err);
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to update credential",
      });
    }
  },
);

/**
 * @openapi
 * /credentials/{id}:
 *   delete:
 *     summary: Delete a credential
 *     description: Deletes a specific credential by its ID.
 *     tags:
 *       - Credentials
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Credential deleted successfully.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Credential not found.
 *       500:
 *         description: Failed to delete credential.
 */
router.delete(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for credential deletion");
      return res.status(400).json({ error: "Invalid request" });
    }
    authLogger.info("Deleting SSH credential", {
      operation: "credential_delete",
      userId,
      credentialId: parseInt(id),
    });

    try {
      const credentialToDelete = await db
        .select()
        .from(sshCredentials)
        .where(
          and(
            eq(sshCredentials.id, parseInt(id)),
            eq(sshCredentials.userId, userId),
          ),
        );

      if (credentialToDelete.length === 0) {
        return res.status(404).json({ error: "Credential not found" });
      }

      const hostsUsingCredential = await db
        .select()
        .from(hosts)
        .where(
          and(eq(hosts.credentialId, parseInt(id)), eq(hosts.userId, userId)),
        );

      if (hostsUsingCredential.length > 0) {
        await db
          .update(hosts)
          .set({
            credentialId: null,
            password: null,
            key: null,
            keyPassword: null,
            authType: "password",
          })
          .where(
            and(eq(hosts.credentialId, parseInt(id)), eq(hosts.userId, userId)),
          );

        for (const host of hostsUsingCredential) {
          const revokedShares = await db
            .delete(hostAccess)
            .where(eq(hostAccess.hostId, host.id))
            .returning({ id: hostAccess.id });

          if (revokedShares.length > 0) {
            authLogger.info(
              "Auto-revoked host shares due to credential deletion",
              {
                operation: "auto_revoke_shares",
                hostId: host.id,
                credentialId: parseInt(id),
                revokedCount: revokedShares.length,
                reason: "credential_deleted",
              },
            );
          }
        }
      }

      const { SharedCredentialManager } =
        await import("../../utils/shared-credential-manager.js");
      const sharedCredManager = SharedCredentialManager.getInstance();
      await sharedCredManager.deleteSharedCredentialsForOriginal(parseInt(id));

      await db
        .delete(sshCredentials)
        .where(
          and(
            eq(sshCredentials.id, parseInt(id)),
            eq(sshCredentials.userId, userId),
          ),
        );

      authLogger.success("SSH credential deleted", {
        operation: "credential_delete_success",
        userId,
        credentialId: parseInt(id),
      });

      res.json({ message: "Credential deleted successfully" });
    } catch (err) {
      authLogger.error("Failed to delete credential", err);
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to delete credential",
      });
    }
  },
);

/**
 * @openapi
 * /credentials/{id}/apply-to-host/{hostId}:
 *   post:
 *     summary: Apply a credential to a host
 *     description: Applies a credential to an SSH host for quick application.
 *     tags:
 *       - Credentials
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Credential applied to host successfully.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Credential not found.
 *       500:
 *         description: Failed to apply credential to host.
 */
router.post(
  "/:id/apply-to-host/:hostId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const credentialId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const hostId = Array.isArray(req.params.hostId)
      ? req.params.hostId[0]
      : req.params.hostId;

    if (!isNonEmptyString(userId) || !credentialId || !hostId) {
      authLogger.warn("Invalid request for credential application");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const credentials = await SimpleDBOps.select(
        db
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, parseInt(credentialId)),
              eq(sshCredentials.userId, userId),
            ),
          ),
        "ssh_credentials",
        userId,
      );

      if (credentials.length === 0) {
        return res.status(404).json({ error: "Credential not found" });
      }

      const credential = credentials[0];

      await db
        .update(hosts)
        .set({
          credentialId: parseInt(credentialId),
          username: (credential.username as string) || "",
          authType: credential.authType as string,
          password: null,
          key: null,
          keyPassword: null,
          keyType: null,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(hosts.id, parseInt(hostId)), eq(hosts.userId, userId)));

      await db.insert(sshCredentialUsage).values({
        credentialId: parseInt(credentialId),
        hostId: parseInt(hostId),
        userId,
      });

      await db
        .update(sshCredentials)
        .set({
          usageCount: sql`${sshCredentials.usageCount}
                + 1`,
          lastUsed: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sshCredentials.id, parseInt(credentialId)));
      res.json({ message: "Credential applied to host successfully" });
    } catch (err) {
      authLogger.error("Failed to apply credential to host", err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to apply credential to host",
      });
    }
  },
);

/**
 * @openapi
 * /credentials/{id}/hosts:
 *   get:
 *     summary: Get hosts using a credential
 *     description: Retrieves a list of hosts that are using a specific credential.
 *     tags:
 *       - Credentials
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: A list of hosts.
 *       400:
 *         description: Invalid request.
 *       500:
 *         description: Failed to fetch hosts using credential.
 */
router.get(
  "/:id/hosts",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const credentialId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;

    if (!isNonEmptyString(userId) || !credentialId) {
      authLogger.warn("Invalid request for credential hosts fetch");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const hostsUsingCredential = await db
        .select()
        .from(hosts)
        .where(
          and(
            eq(hosts.credentialId, parseInt(credentialId)),
            eq(hosts.userId, userId),
          ),
        );

      res.json(hostsUsingCredential.map((host) => formatSSHHostOutput(host)));
    } catch (err) {
      authLogger.error("Failed to fetch hosts using credential", err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch hosts using credential",
      });
    }
  },
);

function formatCredentialOutput(
  credential: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: credential.id,
    name: credential.name,
    description: credential.description,
    folder: credential.folder,
    tags:
      typeof credential.tags === "string"
        ? credential.tags
          ? credential.tags.split(",").filter(Boolean)
          : []
        : [],
    authType: credential.authType,
    username: credential.username || null,
    publicKey: credential.publicKey,
    hasCertPublicKey: !!credential.certPublicKey,
    keyType: credential.keyType,
    detectedKeyType: credential.detectedKeyType,
    usageCount: credential.usageCount || 0,
    lastUsed: credential.lastUsed,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

function formatSSHHostOutput(
  host: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: host.id,
    userId: host.userId,
    name: host.name,
    ip: host.ip,
    port: host.port,
    username: host.username,
    folder: host.folder,
    tags:
      typeof host.tags === "string"
        ? host.tags
          ? host.tags.split(",").filter(Boolean)
          : []
        : [],
    pin: !!host.pin,
    authType: host.authType,
    enableTerminal: !!host.enableTerminal,
    enableTunnel: !!host.enableTunnel,
    tunnelConnections: host.tunnelConnections
      ? JSON.parse(host.tunnelConnections as string)
      : [],
    enableFileManager: !!host.enableFileManager,
    defaultPath: host.defaultPath,
    createdAt: host.createdAt,
    updatedAt: host.updatedAt,
  };
}

/**
 * @openapi
 * /credentials/folders/rename:
 *   put:
 *     summary: Rename a credential folder
 *     description: Renames a credential folder for the authenticated user.
 *     tags:
 *       - Credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               oldName:
 *                 type: string
 *               newName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Folder renamed successfully.
 *       400:
 *         description: Both oldName and newName are required.
 *       500:
 *         description: Failed to rename folder.
 */
router.put(
  "/folders/rename",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { oldName, newName } = req.body;

    if (!isNonEmptyString(oldName) || !isNonEmptyString(newName)) {
      return res
        .status(400)
        .json({ error: "Both oldName and newName are required" });
    }

    if (oldName === newName) {
      return res
        .status(400)
        .json({ error: "Old name and new name cannot be the same" });
    }

    try {
      await db
        .update(sshCredentials)
        .set({ folder: newName })
        .where(
          and(
            eq(sshCredentials.userId, userId),
            eq(sshCredentials.folder, oldName),
          ),
        );

      res.json({ success: true, message: "Folder renamed successfully" });
    } catch (error) {
      authLogger.error("Error renaming credential folder:", error);
      res.status(500).json({ error: "Failed to rename folder" });
    }
  },
);

registerCredentialKeyRoutes(router, authenticateJWT);

registerCredentialDeployRoutes(router, authenticateJWT);

export default router;
