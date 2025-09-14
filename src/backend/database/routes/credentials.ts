import express from "express";
import { db } from "../db/index.js";
import { sshCredentials, sshCredentialUsage, sshData } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authLogger } from "../../utils/logger.js";
import { parseSSHKey, parsePublicKey, detectKeyType, validateKeyPair } from "../../utils/ssh-key-utils.js";
import crypto from "crypto";
import ssh2Pkg from "ssh2";
const { utils: ssh2Utils } = ssh2Pkg;

// Direct SSH key generation with ssh2 - the right way
function generateSSHKeyPair(keyType: string, keySize?: number, passphrase?: string): { success: boolean; privateKey?: string; publicKey?: string; error?: string } {
  console.log('Generating SSH key pair with ssh2:', keyType);

  try {
    // Convert our keyType to ssh2 format
    let ssh2Type = keyType;
    const options: any = {};

    if (keyType === 'ssh-rsa') {
      ssh2Type = 'rsa';
      options.bits = keySize || 2048;
    } else if (keyType === 'ssh-ed25519') {
      ssh2Type = 'ed25519';
    } else if (keyType === 'ecdsa-sha2-nistp256') {
      ssh2Type = 'ecdsa';
      options.bits = 256; // ECDSA P-256 uses 256 bits
    }

    // Add passphrase protection if provided
    if (passphrase && passphrase.trim()) {
      options.passphrase = passphrase;
      options.cipher = 'aes128-cbc'; // Default cipher for encrypted private keys
    }

    // Use ssh2's native key generation
    const keyPair = ssh2Utils.generateKeyPairSync(ssh2Type as any, options);

    console.log('SSH key pair generated successfully!');
    console.log('Private key length:', keyPair.private.length);
    console.log('Public key preview:', keyPair.public.substring(0, 50) + '...');

    return {
      success: true,
      privateKey: keyPair.private,
      publicKey: keyPair.public
    };
  } catch (error) {
    console.error('SSH key generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SSH key generation failed'
    };
  }
}

const router = express.Router();

interface JWTPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

function isNonEmptyString(val: any): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function authenticateJWT(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    authLogger.warn("Missing or invalid Authorization header");
    return res
      .status(401)
      .json({ error: "Missing or invalid Authorization header" });
  }
  const token = authHeader.split(" ")[1];
  const jwtSecret = process.env.JWT_SECRET || "secret";
  try {
    const payload = jwt.verify(token, jwtSecret) as JWTPayload;
    (req as any).userId = payload.userId;
    next();
  } catch (err) {
    authLogger.warn("Invalid or expired token");
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Create a new credential
// POST /credentials
router.post("/", authenticateJWT, async (req: Request, res: Response) => {
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
    const plainPassword = authType === "password" && password ? password : null;
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
          error: `Invalid SSH key: ${keyInfo.error}`
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
      key: plainKey, // backward compatibility
      privateKey: keyInfo?.privateKey || plainKey,
      publicKey: keyInfo?.publicKey || null,
      keyPassword: plainKeyPassword,
      keyType: keyType || null,
      detectedKeyType: keyInfo?.keyType || null,
      usageCount: 0,
      lastUsed: null,
    };

    const result = await db
      .insert(sshCredentials)
      .values(credentialData)
      .returning();
    const created = result[0];

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
      error: err instanceof Error ? err.message : "Failed to create credential",
    });
  }
});

// Get all credentials for the authenticated user
// GET /credentials
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;

  if (!isNonEmptyString(userId)) {
    authLogger.warn("Invalid userId for credential fetch");
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    const credentials = await db
      .select()
      .from(sshCredentials)
      .where(eq(sshCredentials.userId, userId))
      .orderBy(desc(sshCredentials.updatedAt));

    res.json(credentials.map((cred) => formatCredentialOutput(cred)));
  } catch (err) {
    authLogger.error("Failed to fetch credentials", err);
    res.status(500).json({ error: "Failed to fetch credentials" });
  }
});

// Get all unique credential folders for the authenticated user
// GET /credentials/folders
router.get("/folders", authenticateJWT, async (req: Request, res: Response) => {
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
});

// Get a specific credential by ID (with plain text secrets)
// GET /credentials/:id
router.get("/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { id } = req.params;

  if (!isNonEmptyString(userId) || !id) {
    authLogger.warn("Invalid request for credential fetch");
    return res.status(400).json({ error: "Invalid request" });
  }

  try {
    const credentials = await db
      .select()
      .from(sshCredentials)
      .where(
        and(
          eq(sshCredentials.id, parseInt(id)),
          eq(sshCredentials.userId, userId),
        ),
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
      (output as any).key = credential.key; // backward compatibility
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
      error: err instanceof Error ? err.message : "Failed to fetch credential",
    });
  }
});

// Update a credential
// PUT /credentials/:id
router.put("/:id", authenticateJWT, async (req: Request, res: Response) => {
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
      updateFields.key = updateData.key || null; // backward compatibility

      // Parse SSH key if provided
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
            error: `Invalid SSH key: ${keyInfo.error}`
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
      const existing = await db
        .select()
        .from(sshCredentials)
        .where(eq(sshCredentials.id, parseInt(id)));

      return res.json(formatCredentialOutput(existing[0]));
    }

    await db
      .update(sshCredentials)
      .set(updateFields)
      .where(
        and(
          eq(sshCredentials.id, parseInt(id)),
          eq(sshCredentials.userId, userId),
        ),
      );

    const updated = await db
      .select()
      .from(sshCredentials)
      .where(eq(sshCredentials.id, parseInt(id)));

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
      error: err instanceof Error ? err.message : "Failed to update credential",
    });
  }
});

// Delete a credential
// DELETE /credentials/:id
router.delete("/:id", authenticateJWT, async (req: Request, res: Response) => {
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
        and(eq(sshData.credentialId, parseInt(id)), eq(sshData.userId, userId)),
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
      error: err instanceof Error ? err.message : "Failed to delete credential",
    });
  }
});

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
router.post("/detect-key-type", authenticateJWT, async (req: Request, res: Response) => {
  const { privateKey, keyPassword } = req.body;

  console.log("=== Key Detection API Called ===");
  console.log("Request body keys:", Object.keys(req.body));
  console.log("Private key provided:", !!privateKey);
  console.log("Private key type:", typeof privateKey);

  if (!privateKey || typeof privateKey !== "string") {
    console.log("Invalid private key provided");
    return res.status(400).json({ error: "Private key is required" });
  }

  try {
    console.log("Calling parseSSHKey...");
    const keyInfo = parseSSHKey(privateKey, keyPassword);
    console.log("parseSSHKey result:", keyInfo);

    const response = {
      success: keyInfo.success,
      keyType: keyInfo.keyType,
      detectedKeyType: keyInfo.keyType,
      hasPublicKey: !!keyInfo.publicKey,
      error: keyInfo.error || null
    };

    console.log("Sending response:", response);
    res.json(response);
  } catch (error) {
    console.error("Exception in detect-key-type endpoint:", error);
    authLogger.error("Failed to detect key type", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to detect key type"
    });
  }
});

// Detect SSH public key type endpoint
// POST /credentials/detect-public-key-type
router.post("/detect-public-key-type", authenticateJWT, async (req: Request, res: Response) => {
  const { publicKey } = req.body;

  console.log("=== Public Key Detection API Called ===");
  console.log("Request body keys:", Object.keys(req.body));
  console.log("Public key provided:", !!publicKey);
  console.log("Public key type:", typeof publicKey);

  if (!publicKey || typeof publicKey !== "string") {
    console.log("Invalid public key provided");
    return res.status(400).json({ error: "Public key is required" });
  }

  try {
    console.log("Calling parsePublicKey...");
    const keyInfo = parsePublicKey(publicKey);
    console.log("parsePublicKey result:", keyInfo);

    const response = {
      success: keyInfo.success,
      keyType: keyInfo.keyType,
      detectedKeyType: keyInfo.keyType,
      error: keyInfo.error || null
    };

    console.log("Sending response:", response);
    res.json(response);
  } catch (error) {
    console.error("Exception in detect-public-key-type endpoint:", error);
    authLogger.error("Failed to detect public key type", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to detect public key type"
    });
  }
});

// Validate SSH key pair endpoint
// POST /credentials/validate-key-pair
router.post("/validate-key-pair", authenticateJWT, async (req: Request, res: Response) => {
  const { privateKey, publicKey, keyPassword } = req.body;

  console.log("=== Key Pair Validation API Called ===");
  console.log("Request body keys:", Object.keys(req.body));
  console.log("Private key provided:", !!privateKey);
  console.log("Public key provided:", !!publicKey);

  if (!privateKey || typeof privateKey !== "string") {
    console.log("Invalid private key provided");
    return res.status(400).json({ error: "Private key is required" });
  }

  if (!publicKey || typeof publicKey !== "string") {
    console.log("Invalid public key provided");
    return res.status(400).json({ error: "Public key is required" });
  }

  try {
    console.log("Calling validateKeyPair...");
    const validationResult = validateKeyPair(privateKey, publicKey, keyPassword);
    console.log("validateKeyPair result:", validationResult);

    const response = {
      isValid: validationResult.isValid,
      privateKeyType: validationResult.privateKeyType,
      publicKeyType: validationResult.publicKeyType,
      generatedPublicKey: validationResult.generatedPublicKey,
      error: validationResult.error || null
    };

    console.log("Sending response:", response);
    res.json(response);
  } catch (error) {
    console.error("Exception in validate-key-pair endpoint:", error);
    authLogger.error("Failed to validate key pair", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to validate key pair"
    });
  }
});

// Generate new SSH key pair endpoint
// POST /credentials/generate-key-pair
router.post("/generate-key-pair", authenticateJWT, async (req: Request, res: Response) => {
  const { keyType = 'ssh-ed25519', keySize = 2048, passphrase } = req.body;

  console.log("=== Generate Key Pair API Called ===");
  console.log("Key type:", keyType);
  console.log("Key size:", keySize);
  console.log("Has passphrase:", !!passphrase);

  try {
    // Generate SSH keys directly with ssh2
    const result = generateSSHKeyPair(keyType, keySize, passphrase);

    if (result.success && result.privateKey && result.publicKey) {
      const response = {
        success: true,
        privateKey: result.privateKey,
        publicKey: result.publicKey,
        keyType: keyType,
        format: 'ssh',
        algorithm: keyType,
        keySize: keyType === 'ssh-rsa' ? keySize : undefined,
        curve: keyType === 'ecdsa-sha2-nistp256' ? 'nistp256' : undefined
      };

      console.log("SSH key pair generated successfully:", keyType);
      res.json(response);
    } else {
      console.error("SSH key generation failed:", result.error);
      res.status(500).json({
        success: false,
        error: result.error || "Failed to generate SSH key pair"
      });
    }
  } catch (error) {
    console.error("Exception in generate-key-pair endpoint:", error);
    authLogger.error("Failed to generate key pair", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to generate key pair"
    });
  }
});

// Generate public key from private key endpoint
// POST /credentials/generate-public-key
router.post("/generate-public-key", authenticateJWT, async (req: Request, res: Response) => {
  const { privateKey, keyPassword } = req.body;

  console.log("=== Generate Public Key API Called ===");
  console.log("Request body keys:", Object.keys(req.body));
  console.log("Private key provided:", !!privateKey);
  console.log("Private key type:", typeof privateKey);

  if (!privateKey || typeof privateKey !== "string") {
    console.log("Invalid private key provided");
    return res.status(400).json({ error: "Private key is required" });
  }

  try {
    console.log("Using Node.js crypto to generate public key from private key...");
    console.log("Private key length:", privateKey.length);
    console.log("Private key first 100 chars:", privateKey.substring(0, 100));

    // First try to create private key object from the input
    let privateKeyObj;
    let parseAttempts = [];

    // Attempt 1: Direct parsing with passphrase
    try {
      privateKeyObj = crypto.createPrivateKey({
        key: privateKey,
        passphrase: keyPassword
      });
      console.log("Successfully parsed with passphrase method");
    } catch (error) {
      parseAttempts.push(`Method 1 (with passphrase): ${error.message}`);
    }

    // Attempt 2: Direct parsing without passphrase
    if (!privateKeyObj) {
      try {
        privateKeyObj = crypto.createPrivateKey(privateKey);
        console.log("Successfully parsed without passphrase");
      } catch (error) {
        parseAttempts.push(`Method 2 (without passphrase): ${error.message}`);
      }
    }

    // Attempt 3: Try with explicit format specification
    if (!privateKeyObj) {
      try {
        privateKeyObj = crypto.createPrivateKey({
          key: privateKey,
          format: 'pem',
          type: 'pkcs8'
        });
        console.log("Successfully parsed as PKCS#8");
      } catch (error) {
        parseAttempts.push(`Method 3 (PKCS#8): ${error.message}`);
      }
    }

    // Attempt 4: Try as PKCS#1 RSA
    if (!privateKeyObj && privateKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
      try {
        privateKeyObj = crypto.createPrivateKey({
          key: privateKey,
          format: 'pem',
          type: 'pkcs1'
        });
        console.log("Successfully parsed as PKCS#1 RSA");
      } catch (error) {
        parseAttempts.push(`Method 4 (PKCS#1): ${error.message}`);
      }
    }

    // Attempt 5: Try as SEC1 EC
    if (!privateKeyObj && privateKey.includes('-----BEGIN EC PRIVATE KEY-----')) {
      try {
        privateKeyObj = crypto.createPrivateKey({
          key: privateKey,
          format: 'pem',
          type: 'sec1'
        });
        console.log("Successfully parsed as SEC1 EC");
      } catch (error) {
        parseAttempts.push(`Method 5 (SEC1): ${error.message}`);
      }
    }

    // Final attempt: Try using ssh2 as fallback
    if (!privateKeyObj) {
      console.log("Attempting fallback to parseSSHKey function...");
      try {
        const keyInfo = parseSSHKey(privateKey, keyPassword);
        console.log("parseSSHKey fallback result:", keyInfo);

        if (keyInfo.success && keyInfo.publicKey) {
          // Ensure SSH2 fallback also returns proper string
          const publicKeyString = String(keyInfo.publicKey);
          console.log("SSH2 fallback public key type:", typeof publicKeyString);
          console.log("SSH2 fallback public key length:", publicKeyString.length);

          return res.json({
            success: true,
            publicKey: publicKeyString,
            keyType: keyInfo.keyType
          });
        } else {
          parseAttempts.push(`SSH2 fallback: ${keyInfo.error || 'No public key generated'}`);
        }
      } catch (error) {
        parseAttempts.push(`SSH2 fallback exception: ${error.message}`);
      }
    }

    if (!privateKeyObj) {
      console.error("All parsing attempts failed:", parseAttempts);
      return res.status(400).json({
        success: false,
        error: "Unable to parse private key. Tried multiple formats.",
        details: parseAttempts
      });
    }

    // Generate public key from private key
    const publicKeyObj = crypto.createPublicKey(privateKeyObj);
    const publicKeyPem = publicKeyObj.export({
      type: 'spki',
      format: 'pem'
    });

    // Debug: Check what we're actually generating
    console.log("Generated public key type:", typeof publicKeyPem);
    console.log("Generated public key is Buffer:", Buffer.isBuffer(publicKeyPem));

    // Ensure publicKeyPem is a string
    const publicKeyString = typeof publicKeyPem === 'string' ? publicKeyPem : publicKeyPem.toString('utf8');

    console.log("Public key string length:", publicKeyString.length);
    console.log("Generated public key first 100 chars:", publicKeyString.substring(0, 100));
    console.log("Public key is string:", typeof publicKeyString === 'string');
    console.log("Public key contains PEM header:", publicKeyString.includes('-----BEGIN PUBLIC KEY-----'));

    // Detect key type from the private key object
    let keyType = 'unknown';
    const asymmetricKeyType = privateKeyObj.asymmetricKeyType;

    if (asymmetricKeyType === 'rsa') {
      keyType = 'ssh-rsa';
    } else if (asymmetricKeyType === 'ed25519') {
      keyType = 'ssh-ed25519';
    } else if (asymmetricKeyType === 'ec') {
      // For EC keys, we need to check the curve
      keyType = 'ecdsa-sha2-nistp256'; // Default assumption for P-256
    }

    // Use ssh2 to generate SSH format public key
    let finalPublicKey = publicKeyString; // PEM fallback
    let formatType = 'pem';

    try {
      const ssh2PrivateKey = ssh2Utils.parseKey(privateKey, keyPassword);
      if (!(ssh2PrivateKey instanceof Error)) {
        const publicKeyBuffer = ssh2PrivateKey.getPublicSSH();
        const base64Data = publicKeyBuffer.toString('base64');
        finalPublicKey = `${keyType} ${base64Data}`;
        formatType = 'ssh';
        console.log("SSH format public key generated!");
      } else {
        console.warn("ssh2 parsing failed, using PEM format");
      }
    } catch (sshError) {
      console.warn("ssh2 failed, using PEM format");
    }

    const response = {
      success: true,
      publicKey: finalPublicKey,
      keyType: keyType,
      format: formatType
    };

    console.log("Final response publicKey type:", typeof response.publicKey);
    console.log("Final response publicKey format:", response.format);
    console.log("Final response publicKey length:", response.publicKey.length);
    console.log("Public key generated successfully using crypto module:", keyType);

    res.json(response);
  } catch (error) {
    console.error("Exception in generate-public-key endpoint:", error);
    authLogger.error("Failed to generate public key", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to generate public key"
    });
  }
});

export default router;
