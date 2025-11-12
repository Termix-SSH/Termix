import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { snippets } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

// Get all snippets for the authenticated user
// GET /snippets
router.get(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for snippets fetch");
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const result = await db
        .select()
        .from(snippets)
        .where(eq(snippets.userId, userId))
        .orderBy(desc(snippets.updatedAt));

      res.json(result);
    } catch (err) {
      authLogger.error("Failed to fetch snippets", err);
      res.status(500).json({ error: "Failed to fetch snippets" });
    }
  },
);

// Get a specific snippet by ID
// GET /snippets/:id
router.get(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id } = req.params;
    const snippetId = parseInt(id, 10);

    if (!isNonEmptyString(userId) || isNaN(snippetId)) {
      authLogger.warn("Invalid request for snippet fetch: invalid ID", {
        userId,
        id,
      });
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    try {
      const result = await db
        .select()
        .from(snippets)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      if (result.length === 0) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      res.json(result[0]);
    } catch (err) {
      authLogger.error("Failed to fetch snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to fetch snippet",
      });
    }
  },
);

// Create a new snippet
// POST /snippets
router.post(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, content, description } = req.body;

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(name) ||
      !isNonEmptyString(content)
    ) {
      authLogger.warn("Invalid snippet creation data validation failed", {
        operation: "snippet_create",
        userId,
        hasName: !!name,
        hasContent: !!content,
      });
      return res.status(400).json({ error: "Name and content are required" });
    }

    try {
      const insertData = {
        userId,
        name: name.trim(),
        content: content.trim(),
        description: description?.trim() || null,
      };

      const result = await db.insert(snippets).values(insertData).returning();

      authLogger.success(`Snippet created: ${name} by user ${userId}`, {
        operation: "snippet_create_success",
        userId,
        snippetId: result[0].id,
        name,
      });

      res.status(201).json(result[0]);
    } catch (err) {
      authLogger.error("Failed to create snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to create snippet",
      });
    }
  },
);

// Update a snippet
// PUT /snippets/:id
router.put(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id } = req.params;
    const updateData = req.body;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for snippet update");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const existing = await db
        .select()
        .from(snippets)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      if (existing.length === 0) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      const updateFields: Partial<{
        updatedAt: ReturnType<typeof sql.raw>;
        name: string;
        content: string;
        description: string | null;
      }> = {
        updatedAt: sql`CURRENT_TIMESTAMP`,
      };

      if (updateData.name !== undefined)
        updateFields.name = updateData.name.trim();
      if (updateData.content !== undefined)
        updateFields.content = updateData.content.trim();
      if (updateData.description !== undefined)
        updateFields.description = updateData.description?.trim() || null;

      await db
        .update(snippets)
        .set(updateFields)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      const updated = await db
        .select()
        .from(snippets)
        .where(eq(snippets.id, parseInt(id)));

      authLogger.success(
        `Snippet updated: ${updated[0].name} by user ${userId}`,
        {
          operation: "snippet_update_success",
          userId,
          snippetId: parseInt(id),
          name: updated[0].name,
        },
      );

      res.json(updated[0]);
    } catch (err) {
      authLogger.error("Failed to update snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to update snippet",
      });
    }
  },
);

// Delete a snippet
// DELETE /snippets/:id
router.delete(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id } = req.params;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for snippet delete");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const existing = await db
        .select()
        .from(snippets)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      if (existing.length === 0) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      await db
        .delete(snippets)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      authLogger.success(
        `Snippet deleted: ${existing[0].name} by user ${userId}`,
        {
          operation: "snippet_delete_success",
          userId,
          snippetId: parseInt(id),
          name: existing[0].name,
        },
      );

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to delete snippet",
      });
    }
  },
);

// Execute a snippet on a host
// POST /snippets/execute
router.post(
  "/execute",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { snippetId, hostId } = req.body;

    if (!isNonEmptyString(userId) || !snippetId || !hostId) {
      authLogger.warn("Invalid snippet execution request", {
        userId,
        snippetId,
        hostId,
      });
      return res
        .status(400)
        .json({ error: "Snippet ID and Host ID are required" });
    }

    try {
      // Get the snippet
      const snippetResult = await db
        .select()
        .from(snippets)
        .where(
          and(
            eq(snippets.id, parseInt(snippetId)),
            eq(snippets.userId, userId),
          ),
        );

      if (snippetResult.length === 0) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      const snippet = snippetResult[0];

      // Import SSH connection utilities
      const { Client } = await import("ssh2");
      const { sshData, sshCredentials } = await import("../db/schema.js");

      // Get host configuration
      const hostResult = await db
        .select()
        .from(sshData)
        .where(
          and(eq(sshData.id, parseInt(hostId)), eq(sshData.userId, userId)),
        );

      if (hostResult.length === 0) {
        return res.status(404).json({ error: "Host not found" });
      }

      const host = hostResult[0];

      // Resolve credentials if needed
      let password = host.password;
      let privateKey = host.key;
      let passphrase = host.key_password;

      if (host.credentialId) {
        const credResult = await db
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, host.credentialId),
              eq(sshCredentials.userId, userId),
            ),
          );

        if (credResult.length > 0) {
          const cred = credResult[0];
          password = cred.password || undefined;
          privateKey = cred.private_key || cred.key || undefined;
          passphrase = cred.key_password || undefined;
        }
      }

      // Create SSH connection
      const conn = new Client();
      let output = "";
      let errorOutput = "";

      const executePromise = new Promise<{
        success: boolean;
        output: string;
        error?: string;
      }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          conn.end();
          reject(new Error("Command execution timeout (30s)"));
        }, 30000);

        conn.on("ready", () => {
          conn.exec(snippet.content, (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              conn.end();
              return reject(err);
            }

            stream.on("close", () => {
              clearTimeout(timeout);
              conn.end();
              if (errorOutput) {
                resolve({ success: false, output, error: errorOutput });
              } else {
                resolve({ success: true, output });
              }
            });

            stream.on("data", (data: Buffer) => {
              output += data.toString();
            });

            stream.stderr.on("data", (data: Buffer) => {
              errorOutput += data.toString();
            });
          });
        });

        conn.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        // Connect to SSH
        const config: any = {
          host: host.ip,
          port: host.port,
          username: host.username,
          tryKeyboard: true,
          keepaliveInterval: 30000,
          keepaliveCountMax: 3,
          readyTimeout: 30000,
          tcpKeepAlive: true,
          tcpKeepAliveInitialDelay: 30000,
          timeout: 30000,
          env: {
            TERM: "xterm-256color",
            LANG: "en_US.UTF-8",
            LC_ALL: "en_US.UTF-8",
            LC_CTYPE: "en_US.UTF-8",
            LC_MESSAGES: "en_US.UTF-8",
            LC_MONETARY: "en_US.UTF-8",
            LC_NUMERIC: "en_US.UTF-8",
            LC_TIME: "en_US.UTF-8",
            LC_COLLATE: "en_US.UTF-8",
            COLORTERM: "truecolor",
          },
          algorithms: {
            kex: [
              "curve25519-sha256",
              "curve25519-sha256@libssh.org",
              "ecdh-sha2-nistp521",
              "ecdh-sha2-nistp384",
              "ecdh-sha2-nistp256",
              "diffie-hellman-group-exchange-sha256",
              "diffie-hellman-group14-sha256",
              "diffie-hellman-group14-sha1",
              "diffie-hellman-group-exchange-sha1",
              "diffie-hellman-group1-sha1",
            ],
            serverHostKey: [
              "ssh-ed25519",
              "ecdsa-sha2-nistp521",
              "ecdsa-sha2-nistp384",
              "ecdsa-sha2-nistp256",
              "rsa-sha2-512",
              "rsa-sha2-256",
              "ssh-rsa",
              "ssh-dss",
            ],
            cipher: [
              "chacha20-poly1305@openssh.com",
              "aes256-gcm@openssh.com",
              "aes128-gcm@openssh.com",
              "aes256-ctr",
              "aes192-ctr",
              "aes128-ctr",
              "aes256-cbc",
              "aes192-cbc",
              "aes128-cbc",
              "3des-cbc",
            ],
            hmac: [
              "hmac-sha2-512-etm@openssh.com",
              "hmac-sha2-256-etm@openssh.com",
              "hmac-sha2-512",
              "hmac-sha2-256",
              "hmac-sha1",
              "hmac-md5",
            ],
            compress: ["none", "zlib@openssh.com", "zlib"],
          },
        };

        if (password) {
          config.password = password;
        }

        if (privateKey) {
          const cleanKey = privateKey
            .trim()
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");
          config.privateKey = Buffer.from(cleanKey, "utf8");
          if (passphrase) {
            config.passphrase = passphrase;
          }
        }

        conn.connect(config);
      });

      const result = await executePromise;

      authLogger.success(
        `Snippet executed: ${snippet.name} on host ${hostId}`,
        {
          operation: "snippet_execute_success",
          userId,
          snippetId,
          hostId,
        },
      );

      res.json(result);
    } catch (err) {
      authLogger.error("Failed to execute snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to execute snippet",
      });
    }
  },
);

export default router;
