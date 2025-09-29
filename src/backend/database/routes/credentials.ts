import express from "express";
import { db } from "../db/index.js";
import { sshCredentials, sshCredentialUsage, sshData } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authLogger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  parseSSHKey,
  parsePublicKey,
  detectKeyType,
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
    const options: any = {};

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

function isNonEmptyString(val: any): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

// Create a new credential
// POST /credentials
router.post(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;
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
        privateKey: keyInfo?.privateKey || plainKey,
        publicKey: keyInfo?.publicKey || null,
        keyPassword: plainKeyPassword,
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

// Get all credentials for the authenticated user
// GET /credentials
router.get(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;

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

// Get all unique credential folders for the authenticated user
// GET /credentials/folders
router.get(
  "/folders",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;

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

// Get a specific credential by ID (with plain text secrets)
// GET /credentials/:id
router.get(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;

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
        (output as any).password = credential.password;
      }
      if (credential.key) {
        (output as any).key = credential.key;
      }
      if (credential.privateKey) {
        (output as any).privateKey = credential.privateKey;
      }
      if (credential.publicKey) {
        (output as any).publicKey = credential.publicKey;
      }
      if (credential.keyPassword) {
        (output as any).keyPassword = credential.keyPassword;
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

// Update a credential
// PUT /credentials/:id
router.put(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;
    const updateData = req.body;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for credential update");
      return res.status(400).json({ error: "Invalid request" });
    }

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

      const updateFields: any = {};

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
          updateFields.privateKey = keyInfo.privateKey;
          updateFields.publicKey = keyInfo.publicKey;
          updateFields.detectedKeyType = keyInfo.keyType;
        }
      }
      if (updateData.keyPassword !== undefined) {
        updateFields.keyPassword = updateData.keyPassword || null;
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

      const credential = updated[0];
      authLogger.success(
        `SSH credential updated: ${credential.name} (${credential.authType}) by user ${userId}`,
        {
          operation: "credential_update_success",
          userId,
          credentialId: parseInt(id),
          name: credential.name,
          authType: credential.authType,
          username: credential.username,
        },
      );

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

// Delete a credential
// DELETE /credentials/:id
router.delete(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for credential deletion");
      return res.status(400).json({ error: "Invalid request" });
    }

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
            keyPassword: null,
            authType: "password",
          })
          .where(
            and(
              eq(sshData.credentialId, parseInt(id)),
              eq(sshData.userId, userId),
            ),
          );
      }

      await db
        .delete(sshCredentialUsage)
        .where(
          and(
            eq(sshCredentialUsage.credentialId, parseInt(id)),
            eq(sshCredentialUsage.userId, userId),
          ),
        );

      await db
        .delete(sshCredentials)
        .where(
          and(
            eq(sshCredentials.id, parseInt(id)),
            eq(sshCredentials.userId, userId),
          ),
        );

      const credential = credentialToDelete[0];
      authLogger.success(
        `SSH credential deleted: ${credential.name} (${credential.authType}) by user ${userId}`,
        {
          operation: "credential_delete_success",
          userId,
          credentialId: parseInt(id),
          name: credential.name,
          authType: credential.authType,
          username: credential.username,
        },
      );

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

// Apply a credential to an SSH host (for quick application)
// POST /credentials/:id/apply-to-host/:hostId
router.post(
  "/:id/apply-to-host/:hostId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id: credentialId, hostId } = req.params;

    if (!isNonEmptyString(userId) || !credentialId || !hostId) {
      authLogger.warn("Invalid request for credential application");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const credentials = await db
        .select()
        .from(sshCredentials)
        .where(
          and(
            eq(sshCredentials.id, parseInt(credentialId)),
            eq(sshCredentials.userId, userId),
          ),
        );

      if (credentials.length === 0) {
        return res.status(404).json({ error: "Credential not found" });
      }

      const credential = credentials[0];

      await db
        .update(sshData)
        .set({
          credentialId: parseInt(credentialId),
          username: credential.username,
          authType: credential.authType,
          password: null,
          key: null,
          keyPassword: null,
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

// Get hosts using a specific credential
// GET /credentials/:id/hosts
router.get(
  "/:id/hosts",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id: credentialId } = req.params;

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

function formatCredentialOutput(credential: any): any {
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
    username: credential.username,
    publicKey: credential.publicKey,
    keyType: credential.keyType,
    detectedKeyType: credential.detectedKeyType,
    usageCount: credential.usageCount || 0,
    lastUsed: credential.lastUsed,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

function formatSSHHostOutput(host: any): any {
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
      ? JSON.parse(host.tunnelConnections)
      : [],
    enableFileManager: !!host.enableFileManager,
    defaultPath: host.defaultPath,
    createdAt: host.createdAt,
    updatedAt: host.updatedAt,
  };
}

// Rename a credential folder
// PUT /credentials/folders/rename
router.put(
  "/folders/rename",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;
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

// Detect SSH key type endpoint
// POST /credentials/detect-key-type
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

// Detect SSH public key type endpoint
// POST /credentials/detect-public-key-type
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

// Validate SSH key pair endpoint
// POST /credentials/validate-key-pair
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

// Generate new SSH key pair endpoint
// POST /credentials/generate-key-pair
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

// Generate public key from private key endpoint
// POST /credentials/generate-public-key
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
      let parseAttempts = [];

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
      } catch (sshError) {}

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
  hostConfig: any,
  publicKey: string,
  credentialData: any,
): Promise<{ success: boolean; message?: string; error?: string }> {
  return new Promise((resolve) => {
    const conn = new Client();
    let connectionTimeout: NodeJS.Timeout;

    connectionTimeout = setTimeout(() => {
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

              stream.on("data", (data) => {});
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
            } catch (e) {}

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

                stream.on("close", (code) => {
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
          } catch (e) {}

          const escapedKey = actualPublicKey
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "'\\''");

          conn.exec(
            `printf '%s\\n' '${escapedKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
            (err, stream) => {
              if (err) {
                clearTimeout(addTimeout);
                return rejectAdd(err);
              }

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
            } catch (e) {}

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

                stream.on("close", (code) => {
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
      const connectionConfig: any = {
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
          if (
            !hostConfig.privateKey.includes("-----BEGIN") ||
            !hostConfig.privateKey.includes("-----END")
          ) {
            throw new Error("Invalid private key format");
          }

          const cleanKey = hostConfig.privateKey
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

// Deploy SSH Key to Host endpoint
// POST /credentials/:id/deploy-to-host
router.post(
  "/:id/deploy-to-host",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const credentialId = parseInt(req.params.id);
    const { targetHostId } = req.body;

    if (!credentialId || !targetHostId) {
      return res.status(400).json({
        success: false,
        error: "Credential ID and target host ID are required",
      });
    }

    try {
      const userId = (req as any).userId;
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

      const credData = credential[0];

      if (credData.authType !== "key") {
        return res.status(400).json({
          success: false,
          error: "Only SSH key-based credentials can be deployed",
        });
      }

      if (!credData.publicKey) {
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

      let hostConfig = {
        ip: hostData.ip,
        port: hostData.port,
        username: hostData.username,
        authType: hostData.authType,
        password: hostData.password,
        privateKey: hostData.key,
        keyPassword: hostData.keyPassword,
      };

      if (hostData.authType === "credential" && hostData.credentialId) {
        const userId = (req as any).userId;
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
              .where(eq(sshCredentials.id, hostData.credentialId))
              .limit(1),
            "ssh_credentials",
            userId,
          );

          if (hostCredential && hostCredential.length > 0) {
            const cred = hostCredential[0];

            hostConfig.authType = cred.authType;
            hostConfig.username = cred.username;

            if (cred.authType === "password") {
              hostConfig.password = cred.password;
            } else if (cred.authType === "key") {
              hostConfig.privateKey = cred.privateKey || cred.key;
              hostConfig.keyPassword = cred.keyPassword;
            }
          } else {
            return res.status(400).json({
              success: false,
              error: "Host credential not found",
            });
          }
        } catch (error) {
          return res.status(500).json({
            success: false,
            error: "Failed to resolve host credentials",
          });
        }
      }

      const deployResult = await deploySSHKeyToHost(
        hostConfig,
        credData.publicKey,
        credData,
      );

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
