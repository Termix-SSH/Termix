import type {
  AuthenticatedRequest,
  CredentialBackend,
} from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import {
  sshCredentials,
  sshCredentialUsage,
  sshData,
  hostAccess,
} from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { authLogger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  parseSSHKey,
  parsePublicKey,
  validateKeyPair,
} from "../../utils/ssh-key-utils.js";
import crypto from "crypto";
import ssh2Pkg from "ssh2";
const { utils: ssh2Utils, Client } = ssh2Pkg;

function generateSSHKeyPair(
  keyType: string,
  keySize?: number,
  passphrase?: string,
): {
  success: boolean;
  privateKey?: string;
  publicKey?: string;
  error?: string;
} {
  try {
    let ssh2Type = keyType;
    const options: {
      bits?: number;
      passphrase?: string;
      cipher?: string;
    } = {};

    if (keyType === "ssh-rsa") {
      ssh2Type = "rsa";
      options.bits = keySize || 2048;
    } else if (keyType === "ssh-ed25519") {
      ssh2Type = "ed25519";
    } else if (keyType === "ecdsa-sha2-nistp256") {
      ssh2Type = "ecdsa";
      options.bits = 256;
    }

    if (passphrase && passphrase.trim()) {
      options.passphrase = passphrase;
      options.cipher = "aes128-cbc";
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyPair = ssh2Utils.generateKeyPairSync(ssh2Type as any, options);

    return {
      success: true,
      privateKey: keyPair.private,
      publicKey: keyPair.public,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "SSH key generation failed",
    };
  }
}

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
    } = req.body;

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(name) ||
      !isNonEmptyString(username)
    ) {
      authLogger.warn("Invalid credential creation data validation failed", {
        operation: "credential_create",
        userId,
        hasName: !!name,
        hasUsername: !!username,
      });
      return res.status(400).json({ error: "Name and username are required" });
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
        username: username.trim(),
        password: plainPassword,
        key: plainKey,
        private_key: keyInfo?.privateKey || plainKey,
        public_key: keyInfo?.publicKey || null,
        key_password: plainKeyPassword,
        keyType: keyType || null,
        detectedKeyType: keyInfo?.keyType || null,
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
      if (credential.key) {
        output.key = credential.key;
      }
      if (credential.private_key) {
        output.privateKey = credential.private_key;
      }
      if (credential.public_key) {
        output.publicKey = credential.public_key;
      }
      if (credential.key_password) {
        output.keyPassword = credential.key_password;
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
        updateFields.username = updateData.username.trim();
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
          updateFields.private_key = keyInfo.privateKey;
          updateFields.public_key = keyInfo.publicKey;
          updateFields.detectedKeyType = keyInfo.keyType;
        }
      }
      if (updateData.keyPassword !== undefined) {
        updateFields.key_password = updateData.keyPassword || null;
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

      const credential = updated[0];
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
        .from(sshData)
        .where(
          and(
            eq(sshData.credentialId, parseInt(id)),
            eq(sshData.userId, userId),
          ),
        );

      if (hostsUsingCredential.length > 0) {
        await db
          .update(sshData)
          .set({
            credentialId: null,
            password: null,
            key: null,
            key_password: null,
            authType: "password",
          })
          .where(
            and(
              eq(sshData.credentialId, parseInt(id)),
              eq(sshData.userId, userId),
            ),
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

      const credential = credentialToDelete[0];
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
        .update(sshData)
        .set({
          credentialId: parseInt(credentialId),
          username: credential.username as string,
          authType: (credential.auth_type || credential.authType) as string,
          password: null,
          key: null,
          key_password: null,
          keyType: null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(eq(sshData.id, parseInt(hostId)), eq(sshData.userId, userId)),
        );

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
      const hosts = await db
        .select()
        .from(sshData)
        .where(
          and(
            eq(sshData.credentialId, parseInt(credentialId)),
            eq(sshData.userId, userId),
          ),
        );

      res.json(hosts.map((host) => formatSSHHostOutput(host)));
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
    authType: credential.authType || credential.auth_type,
    username: credential.username,
    publicKey: credential.public_key || credential.publicKey,
    keyType: credential.key_type || credential.keyType,
    detectedKeyType: credential.detected_key_type || credential.detectedKeyType,
    usageCount: credential.usage_count || credential.usageCount || 0,
    lastUsed: credential.last_used || credential.lastUsed,
    createdAt: credential.created_at || credential.createdAt,
    updatedAt: credential.updated_at || credential.updatedAt,
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

/**
 * @openapi
 * /credentials/detect-key-type:
 *   post:
 *     summary: Detect SSH key type
 *     description: Detects the type of an SSH private key.
 *     tags:
 *       - Credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               privateKey:
 *                 type: string
 *               keyPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Key type detection result.
 *       400:
 *         description: Private key is required.
 *       500:
 *         description: Failed to detect key type.
 */
router.post(
  "/detect-key-type",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const { privateKey, keyPassword } = req.body;

    if (!privateKey || typeof privateKey !== "string") {
      return res.status(400).json({ error: "Private key is required" });
    }

    try {
      const keyInfo = parseSSHKey(privateKey, keyPassword);

      const response = {
        success: keyInfo.success,
        keyType: keyInfo.keyType,
        detectedKeyType: keyInfo.keyType,
        hasPublicKey: !!keyInfo.publicKey,
        error: keyInfo.error || null,
      };

      res.json(response);
    } catch (error) {
      authLogger.error("Failed to detect key type", error);
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to detect key type",
      });
    }
  },
);

/**
 * @openapi
 * /credentials/detect-public-key-type:
 *   post:
 *     summary: Detect SSH public key type
 *     description: Detects the type of an SSH public key.
 *     tags:
 *       - Credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               publicKey:
 *                 type: string
 *     responses:
 *       200:
 *         description: Key type detection result.
 *       400:
 *         description: Public key is required.
 *       500:
 *         description: Failed to detect public key type.
 */
router.post(
  "/detect-public-key-type",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const { publicKey } = req.body;

    if (!publicKey || typeof publicKey !== "string") {
      return res.status(400).json({ error: "Public key is required" });
    }

    try {
      const keyInfo = parsePublicKey(publicKey);

      const response = {
        success: keyInfo.success,
        keyType: keyInfo.keyType,
        detectedKeyType: keyInfo.keyType,
        error: keyInfo.error || null,
      };

      res.json(response);
    } catch (error) {
      authLogger.error("Failed to detect public key type", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to detect public key type",
      });
    }
  },
);

/**
 * @openapi
 * /credentials/validate-key-pair:
 *   post:
 *     summary: Validate SSH key pair
 *     description: Validates if a given SSH private key and public key match.
 *     tags:
 *       - Credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               privateKey:
 *                 type: string
 *               publicKey:
 *                 type: string
 *               keyPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Key pair validation result.
 *       400:
 *         description: Private key and public key are required.
 *       500:
 *         description: Failed to validate key pair.
 */
router.post(
  "/validate-key-pair",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const { privateKey, publicKey, keyPassword } = req.body;

    if (!privateKey || typeof privateKey !== "string") {
      return res.status(400).json({ error: "Private key is required" });
    }

    if (!publicKey || typeof publicKey !== "string") {
      return res.status(400).json({ error: "Public key is required" });
    }

    try {
      const validationResult = validateKeyPair(
        privateKey,
        publicKey,
        keyPassword,
      );

      const response = {
        isValid: validationResult.isValid,
        privateKeyType: validationResult.privateKeyType,
        publicKeyType: validationResult.publicKeyType,
        generatedPublicKey: validationResult.generatedPublicKey,
        error: validationResult.error || null,
      };

      res.json(response);
    } catch (error) {
      authLogger.error("Failed to validate key pair", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to validate key pair",
      });
    }
  },
);

/**
 * @openapi
 * /credentials/generate-key-pair:
 *   post:
 *     summary: Generate new SSH key pair
 *     description: Generates a new SSH key pair.
 *     tags:
 *       - Credentials
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               keyType:
 *                 type: string
 *               keySize:
 *                 type: integer
 *               passphrase:
 *                 type: string
 *     responses:
 *       200:
 *         description: The new key pair.
 *       500:
 *         description: Failed to generate SSH key pair.
 */
router.post(
  "/generate-key-pair",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const { keyType = "ssh-ed25519", keySize = 2048, passphrase } = req.body;

    try {
      const result = generateSSHKeyPair(keyType, keySize, passphrase);

      if (result.success && result.privateKey && result.publicKey) {
        const response = {
          success: true,
          privateKey: result.privateKey,
          publicKey: result.publicKey,
          keyType: keyType,
          format: "ssh",
          algorithm: keyType,
          keySize: keyType === "ssh-rsa" ? keySize : undefined,
          curve: keyType === "ecdsa-sha2-nistp256" ? "nistp256" : undefined,
        };

        res.json(response);
      } else {
        res.status(500).json({
          success: false,
          error: result.error || "Failed to generate SSH key pair",
        });
      }
    } catch (error) {
      authLogger.error("Failed to generate key pair", error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate key pair",
      });
    }
  },
);

/**
 * @openapi
 * /credentials/generate-public-key:
 *   post:
 *     summary: Generate public key from private key
 *     description: Generates a public key from a given private key.
 *     tags:
 *       - Credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               privateKey:
 *                 type: string
 *               keyPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: The generated public key.
 *       400:
 *         description: Private key is required.
 *       500:
 *         description: Failed to generate public key.
 */
router.post(
  "/generate-public-key",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const { privateKey, keyPassword } = req.body;

    if (!privateKey || typeof privateKey !== "string") {
      return res.status(400).json({ error: "Private key is required" });
    }

    try {
      let privateKeyObj;
      const parseAttempts = [];

      try {
        privateKeyObj = crypto.createPrivateKey({
          key: privateKey,
          passphrase: keyPassword,
        });
      } catch (error) {
        parseAttempts.push(`Method 1 (with passphrase): ${error.message}`);
      }

      if (!privateKeyObj) {
        try {
          privateKeyObj = crypto.createPrivateKey(privateKey);
        } catch (error) {
          parseAttempts.push(`Method 2 (without passphrase): ${error.message}`);
        }
      }

      if (!privateKeyObj) {
        try {
          privateKeyObj = crypto.createPrivateKey({
            key: privateKey,
            format: "pem",
            type: "pkcs8",
          });
        } catch (error) {
          parseAttempts.push(`Method 3 (PKCS#8): ${error.message}`);
        }
      }

      if (
        !privateKeyObj &&
        privateKey.includes("-----BEGIN RSA PRIVATE KEY-----")
      ) {
        try {
          privateKeyObj = crypto.createPrivateKey({
            key: privateKey,
            format: "pem",
            type: "pkcs1",
          });
        } catch (error) {
          parseAttempts.push(`Method 4 (PKCS#1): ${error.message}`);
        }
      }

      if (
        !privateKeyObj &&
        privateKey.includes("-----BEGIN EC PRIVATE KEY-----")
      ) {
        try {
          privateKeyObj = crypto.createPrivateKey({
            key: privateKey,
            format: "pem",
            type: "sec1",
          });
        } catch (error) {
          parseAttempts.push(`Method 5 (SEC1): ${error.message}`);
        }
      }

      if (!privateKeyObj) {
        try {
          const keyInfo = parseSSHKey(privateKey, keyPassword);

          if (keyInfo.success && keyInfo.publicKey) {
            const publicKeyString = String(keyInfo.publicKey);
            return res.json({
              success: true,
              publicKey: publicKeyString,
              keyType: keyInfo.keyType,
            });
          } else {
            parseAttempts.push(
              `SSH2 fallback: ${keyInfo.error || "No public key generated"}`,
            );
          }
        } catch (error) {
          parseAttempts.push(`SSH2 fallback exception: ${error.message}`);
        }
      }

      if (!privateKeyObj) {
        return res.status(400).json({
          success: false,
          error: "Unable to parse private key. Tried multiple formats.",
          details: parseAttempts,
        });
      }

      const publicKeyObj = crypto.createPublicKey(privateKeyObj);
      const publicKeyPem = publicKeyObj.export({
        type: "spki",
        format: "pem",
      });

      const publicKeyString =
        typeof publicKeyPem === "string"
          ? publicKeyPem
          : publicKeyPem.toString("utf8");

      let keyType = "unknown";
      const asymmetricKeyType = privateKeyObj.asymmetricKeyType;

      if (asymmetricKeyType === "rsa") {
        keyType = "ssh-rsa";
      } else if (asymmetricKeyType === "ed25519") {
        keyType = "ssh-ed25519";
      } else if (asymmetricKeyType === "ec") {
        keyType = "ecdsa-sha2-nistp256";
      }

      let finalPublicKey = publicKeyString;
      let formatType = "pem";

      try {
        const ssh2PrivateKey = ssh2Utils.parseKey(privateKey, keyPassword);
        if (!(ssh2PrivateKey instanceof Error)) {
          const publicKeyBuffer = ssh2PrivateKey.getPublicSSH();
          const base64Data = publicKeyBuffer.toString("base64");
          finalPublicKey = `${keyType} ${base64Data}`;
          formatType = "ssh";
        }
      } catch {
        // Ignore validation errors
      }

      const response = {
        success: true,
        publicKey: finalPublicKey,
        keyType: keyType,
        format: formatType,
      };

      res.json(response);
    } catch (error) {
      authLogger.error("Failed to generate public key", error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate public key",
      });
    }
  },
);

async function deploySSHKeyToHost(
  hostConfig: Record<string, unknown>,
  credData: CredentialBackend,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const publicKey = credData.public_key as string;
  return new Promise((resolve) => {
    const conn = new Client();

    const connectionTimeout = setTimeout(() => {
      conn.destroy();
      resolve({ success: false, error: "Connection timeout" });
    }, 120000);

    conn.on("ready", async () => {
      clearTimeout(connectionTimeout);

      try {
        await new Promise<void>((resolveCmd, rejectCmd) => {
          const cmdTimeout = setTimeout(() => {
            rejectCmd(new Error("mkdir command timeout"));
          }, 10000);

          conn.exec(
            "test -d ~/.ssh || mkdir -p ~/.ssh; chmod 700 ~/.ssh",
            (err, stream) => {
              if (err) {
                clearTimeout(cmdTimeout);
                return rejectCmd(err);
              }

              stream.on("close", (code) => {
                clearTimeout(cmdTimeout);
                if (code === 0) {
                  resolveCmd();
                } else {
                  rejectCmd(
                    new Error(`mkdir command failed with code ${code}`),
                  );
                }
              });

              stream.on("data", () => {
                // Ignore output
              });
            },
          );
        });

        const keyExists = await new Promise<boolean>(
          (resolveCheck, rejectCheck) => {
            const checkTimeout = setTimeout(() => {
              rejectCheck(new Error("Key check timeout"));
            }, 5000);

            let actualPublicKey = publicKey;
            try {
              const parsed = JSON.parse(publicKey);
              if (parsed.data) {
                actualPublicKey = parsed.data;
              }
            } catch {
              // Ignore parse errors
            }

            const keyParts = actualPublicKey.trim().split(" ");
            if (keyParts.length < 2) {
              clearTimeout(checkTimeout);
              return rejectCheck(
                new Error(
                  "Invalid public key format - must contain at least 2 parts",
                ),
              );
            }

            const keyPattern = keyParts[1];

            conn.exec(
              `if [ -f ~/.ssh/authorized_keys ]; then grep -F "${keyPattern}" ~/.ssh/authorized_keys >/dev/null 2>&1; echo $?; else echo 1; fi`,
              (err, stream) => {
                if (err) {
                  clearTimeout(checkTimeout);
                  return rejectCheck(err);
                }

                let output = "";
                stream.on("data", (data) => {
                  output += data.toString();
                });

                stream.on("close", () => {
                  clearTimeout(checkTimeout);
                  const exists = output.trim() === "0";
                  resolveCheck(exists);
                });
              },
            );
          },
        );

        if (keyExists) {
          conn.end();
          resolve({ success: true, message: "SSH key already deployed" });
          return;
        }

        await new Promise<void>((resolveAdd, rejectAdd) => {
          const addTimeout = setTimeout(() => {
            rejectAdd(new Error("Key add timeout"));
          }, 30000);

          let actualPublicKey = publicKey;
          try {
            const parsed = JSON.parse(publicKey);
            if (parsed.data) {
              actualPublicKey = parsed.data;
            }
          } catch {
            // Ignore parse errors
          }

          const escapedKey = actualPublicKey
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "'\\''");

          conn.exec(
            `printf '%s\n' '${escapedKey} ${credData.name}@Termix' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
            (err, stream) => {
              if (err) {
                clearTimeout(addTimeout);
                return rejectAdd(err);
              }

              stream.on("data", () => {
                // Consume output
              });

              stream.on("close", (code) => {
                clearTimeout(addTimeout);
                if (code === 0) {
                  resolveAdd();
                } else {
                  rejectAdd(
                    new Error(`Key deployment failed with code ${code}`),
                  );
                }
              });
            },
          );
        });

        const verifySuccess = await new Promise<boolean>(
          (resolveVerify, rejectVerify) => {
            const verifyTimeout = setTimeout(() => {
              rejectVerify(new Error("Key verification timeout"));
            }, 5000);

            let actualPublicKey = publicKey;
            try {
              const parsed = JSON.parse(publicKey);
              if (parsed.data) {
                actualPublicKey = parsed.data;
              }
            } catch {
              // Ignore parse errors
            }

            const keyParts = actualPublicKey.trim().split(" ");
            if (keyParts.length < 2) {
              clearTimeout(verifyTimeout);
              return rejectVerify(
                new Error(
                  "Invalid public key format - must contain at least 2 parts",
                ),
              );
            }

            const keyPattern = keyParts[1];
            conn.exec(
              `grep -F "${keyPattern}" ~/.ssh/authorized_keys >/dev/null 2>&1; echo $?`,
              (err, stream) => {
                if (err) {
                  clearTimeout(verifyTimeout);
                  return rejectVerify(err);
                }

                let output = "";
                stream.on("data", (data) => {
                  output += data.toString();
                });

                stream.on("close", () => {
                  clearTimeout(verifyTimeout);
                  const verified = output.trim() === "0";
                  resolveVerify(verified);
                });
              },
            );
          },
        );

        conn.end();

        if (verifySuccess) {
          resolve({ success: true, message: "SSH key deployed successfully" });
        } else {
          resolve({
            success: false,
            error: "Key deployment verification failed",
          });
        }
      } catch (error) {
        conn.end();
        resolve({
          success: false,
          error: error instanceof Error ? error.message : "Deployment failed",
        });
      }
    });

    conn.on("error", (err) => {
      clearTimeout(connectionTimeout);
      let errorMessage = err.message;

      if (
        err.message.includes("All configured authentication methods failed")
      ) {
        errorMessage =
          "Authentication failed. Please check your credentials and ensure the SSH service is running.";
      } else if (
        err.message.includes("ENOTFOUND") ||
        err.message.includes("ENOENT")
      ) {
        errorMessage = "Could not resolve hostname or connect to server.";
      } else if (err.message.includes("ECONNREFUSED")) {
        errorMessage =
          "Connection refused. The server may not be running or the port may be incorrect.";
      } else if (err.message.includes("ETIMEDOUT")) {
        errorMessage =
          "Connection timed out. Check your network connection and server availability.";
      } else if (
        err.message.includes("authentication failed") ||
        err.message.includes("Permission denied")
      ) {
        errorMessage =
          "Authentication failed. Please check your username and password/key.";
      }

      resolve({ success: false, error: errorMessage });
    });

    try {
      const connectionConfig: Record<string, unknown> = {
        host: hostConfig.ip,
        port: hostConfig.port || 22,
        username: hostConfig.username,
        readyTimeout: 60000,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
        tcpKeepAlive: true,
        tcpKeepAliveInitialDelay: 30000,
        algorithms: {
          kex: [
            "diffie-hellman-group14-sha256",
            "diffie-hellman-group14-sha1",
            "diffie-hellman-group1-sha1",
            "diffie-hellman-group-exchange-sha256",
            "diffie-hellman-group-exchange-sha1",
            "ecdh-sha2-nistp256",
            "ecdh-sha2-nistp384",
            "ecdh-sha2-nistp521",
          ],
          cipher: [
            "aes128-ctr",
            "aes192-ctr",
            "aes256-ctr",
            "aes128-gcm@openssh.com",
            "aes256-gcm@openssh.com",
            "aes128-cbc",
            "aes192-cbc",
            "aes256-cbc",
            "3des-cbc",
          ],
          hmac: [
            "hmac-sha2-256-etm@openssh.com",
            "hmac-sha2-512-etm@openssh.com",
            "hmac-sha2-256",
            "hmac-sha2-512",
            "hmac-sha1",
            "hmac-md5",
          ],
          compress: ["none", "zlib@openssh.com", "zlib"],
        },
      };

      if (hostConfig.authType === "password" && hostConfig.password) {
        connectionConfig.password = hostConfig.password;
      } else if (hostConfig.authType === "key" && hostConfig.privateKey) {
        try {
          const privateKey = hostConfig.privateKey as string;
          if (
            !privateKey.includes("-----BEGIN") ||
            !privateKey.includes("-----END")
          ) {
            throw new Error("Invalid private key format");
          }

          const cleanKey = privateKey
            .trim()
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");

          connectionConfig.privateKey = Buffer.from(cleanKey, "utf8");

          if (hostConfig.keyPassword) {
            connectionConfig.passphrase = hostConfig.keyPassword;
          }
        } catch (keyError) {
          clearTimeout(connectionTimeout);
          resolve({
            success: false,
            error: `Invalid SSH key format: ${keyError instanceof Error ? keyError.message : "Unknown error"}`,
          });
          return;
        }
      } else {
        clearTimeout(connectionTimeout);
        resolve({
          success: false,
          error: `Invalid authentication configuration. Auth type: ${hostConfig.authType}, has password: ${!!hostConfig.password}, has key: ${!!hostConfig.privateKey}`,
        });
        return;
      }

      conn.connect(connectionConfig);
    } catch (error) {
      clearTimeout(connectionTimeout);
      resolve({
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      });
    }
  });
}

/**
 * @openapi
 * /credentials/{id}/deploy-to-host:
 *   post:
 *     summary: Deploy SSH key to a host
 *     description: Deploys an SSH public key to a target host's authorized_keys file.
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
 *               targetHostId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: SSH key deployed successfully.
 *       400:
 *         description: Credential ID and target host ID are required.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: Credential or target host not found.
 *       500:
 *         description: Failed to deploy SSH key.
 */
router.post(
  "/:id/deploy-to-host",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const credentialId = parseInt(id);
    const { targetHostId } = req.body;

    if (!credentialId || !targetHostId) {
      return res.status(400).json({
        success: false,
        error: "Credential ID and target host ID are required",
      });
    }

    try {
      const userId = (req as AuthenticatedRequest).userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const { SimpleDBOps } = await import("../../utils/simple-db-ops.js");
      const credential = await SimpleDBOps.select(
        db
          .select()
          .from(sshCredentials)
          .where(eq(sshCredentials.id, credentialId))
          .limit(1),
        "ssh_credentials",
        userId,
      );

      if (!credential || credential.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Credential not found",
        });
      }

      const credData = credential[0] as unknown as CredentialBackend;

      if (credData.authType !== "key") {
        return res.status(400).json({
          success: false,
          error: "Only SSH key-based credentials can be deployed",
        });
      }

      const publicKey = credData.public_key;
      if (!publicKey) {
        return res.status(400).json({
          success: false,
          error: "Public key is required for deployment",
        });
      }
      const targetHost = await SimpleDBOps.select(
        db.select().from(sshData).where(eq(sshData.id, targetHostId)).limit(1),
        "ssh_data",
        userId,
      );

      if (!targetHost || targetHost.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Target host not found",
        });
      }

      const hostData = targetHost[0];

      const hostConfig = {
        ip: hostData.ip,
        port: hostData.port,
        username: hostData.username,
        authType: hostData.authType,
        password: hostData.password,
        privateKey: hostData.key,
        keyPassword: hostData.keyPassword,
      };

      if (hostData.authType === "credential" && hostData.credentialId) {
        const userId = (req as AuthenticatedRequest).userId;
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: "Authentication required for credential resolution",
          });
        }

        try {
          const { SimpleDBOps } = await import("../../utils/simple-db-ops.js");
          const hostCredential = await SimpleDBOps.select(
            db
              .select()
              .from(sshCredentials)
              .where(eq(sshCredentials.id, hostData.credentialId as number))
              .limit(1),
            "ssh_credentials",
            userId,
          );

          if (hostCredential && hostCredential.length > 0) {
            const cred = hostCredential[0];

            hostConfig.authType = cred.auth_type || cred.authType;
            hostConfig.username = cred.username;

            if ((cred.auth_type || cred.authType) === "password") {
              hostConfig.password = cred.password;
            } else if ((cred.auth_type || cred.authType) === "key") {
              hostConfig.privateKey =
                cred.private_key || cred.privateKey || cred.key;
              hostConfig.keyPassword = cred.key_password || cred.keyPassword;
            }
          } else {
            return res.status(400).json({
              success: false,
              error: "Host credential not found",
            });
          }
        } catch {
          return res.status(500).json({
            success: false,
            error: "Failed to resolve host credentials",
          });
        }
      }

      const deployResult = await deploySSHKeyToHost(hostConfig, credData);

      if (deployResult.success) {
        res.json({
          success: true,
          message: deployResult.message || "SSH key deployed successfully",
        });
      } else {
        res.status(500).json({
          success: false,
          error: deployResult.error || "Deployment failed",
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to deploy SSH key",
      });
    }
  },
);

export default router;
