import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { snippets, snippetFolders } from "../db/schema.js";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { authLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

/**
 * @openapi
 * /snippets/folders:
 *   get:
 *     summary: Get all snippet folders
 *     description: Retrieves all snippet folders for the authenticated user.
 *     tags:
 *       - Snippets
 *     responses:
 *       200:
 *         description: A list of snippet folders.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to fetch snippet folders.
 */
router.get(
  "/folders",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for snippet folders fetch");
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const result = await db
        .select()
        .from(snippetFolders)
        .where(eq(snippetFolders.userId, userId))
        .orderBy(asc(snippetFolders.name));

      res.json(result);
    } catch (err) {
      authLogger.error("Failed to fetch snippet folders", err);
      res.status(500).json({ error: "Failed to fetch snippet folders" });
    }
  },
);

/**
 * @openapi
 * /snippets/folders:
 *   post:
 *     summary: Create a new snippet folder
 *     description: Creates a new snippet folder for the authenticated user.
 *     tags:
 *       - Snippets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               color:
 *                 type: string
 *               icon:
 *                 type: string
 *     responses:
 *       201:
 *         description: Snippet folder created successfully.
 *       400:
 *         description: Folder name is required.
 *       409:
 *         description: Folder with this name already exists.
 *       500:
 *         description: Failed to create snippet folder.
 */
router.post(
  "/folders",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, color, icon } = req.body;

    if (!isNonEmptyString(userId) || !isNonEmptyString(name)) {
      authLogger.warn("Invalid snippet folder creation data", {
        operation: "snippet_folder_create",
        userId,
        hasName: !!name,
      });
      return res.status(400).json({ error: "Folder name is required" });
    }

    try {
      const existing = await db
        .select()
        .from(snippetFolders)
        .where(
          and(eq(snippetFolders.userId, userId), eq(snippetFolders.name, name)),
        );

      if (existing.length > 0) {
        return res
          .status(409)
          .json({ error: "Folder with this name already exists" });
      }

      const insertData = {
        userId,
        name: name.trim(),
        color: color?.trim() || null,
        icon: icon?.trim() || null,
      };

      const result = await db
        .insert(snippetFolders)
        .values(insertData)
        .returning();

      authLogger.success(`Snippet folder created: ${name} by user ${userId}`, {
        operation: "snippet_folder_create_success",
        userId,
        name,
      });

      res.status(201).json(result[0]);
    } catch (err) {
      authLogger.error("Failed to create snippet folder", err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to create snippet folder",
      });
    }
  },
);

/**
 * @openapi
 * /snippets/folders/{name}/metadata:
 *   put:
 *     summary: Update snippet folder metadata
 *     description: Updates the metadata (color, icon) of a snippet folder.
 *     tags:
 *       - Snippets
 *     parameters:
 *       - in: path
 *         name: name
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
 *               color:
 *                 type: string
 *               icon:
 *                 type: string
 *     responses:
 *       200:
 *         description: Snippet folder metadata updated successfully.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Folder not found.
 *       500:
 *         description: Failed to update snippet folder metadata.
 */
router.put(
  "/folders/:name/metadata",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const name = Array.isArray(req.params.name)
      ? req.params.name[0]
      : req.params.name;
    const { color, icon } = req.body;

    if (!isNonEmptyString(userId) || !name) {
      authLogger.warn("Invalid request for snippet folder metadata update");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const existing = await db
        .select()
        .from(snippetFolders)
        .where(
          and(
            eq(snippetFolders.userId, userId),
            eq(snippetFolders.name, decodeURIComponent(name)),
          ),
        );

      if (existing.length === 0) {
        return res.status(404).json({ error: "Folder not found" });
      }

      const updateFields: Partial<{
        color: string | null;
        icon: string | null;
        updatedAt: ReturnType<typeof sql.raw>;
      }> = {
        updatedAt: sql`CURRENT_TIMESTAMP`,
      };

      if (color !== undefined) updateFields.color = color?.trim() || null;
      if (icon !== undefined) updateFields.icon = icon?.trim() || null;

      await db
        .update(snippetFolders)
        .set(updateFields)
        .where(
          and(
            eq(snippetFolders.userId, userId),
            eq(snippetFolders.name, decodeURIComponent(name)),
          ),
        );

      const updated = await db
        .select()
        .from(snippetFolders)
        .where(
          and(
            eq(snippetFolders.userId, userId),
            eq(snippetFolders.name, decodeURIComponent(name)),
          ),
        );

      authLogger.success(
        `Snippet folder metadata updated: ${name} by user ${userId}`,
        {
          operation: "snippet_folder_metadata_update_success",
          userId,
          name,
        },
      );

      res.json(updated[0]);
    } catch (err) {
      authLogger.error("Failed to update snippet folder metadata", err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to update snippet folder metadata",
      });
    }
  },
);

/**
 * @openapi
 * /snippets/folders/rename:
 *   put:
 *     summary: Rename a snippet folder
 *     description: Renames a snippet folder for the authenticated user.
 *     tags:
 *       - Snippets
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
 *         description: Invalid request.
 *       404:
 *         description: Folder not found.
 *       409:
 *         description: Folder with new name already exists.
 *       500:
 *         description: Failed to rename snippet folder.
 */
router.put(
  "/folders/rename",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { oldName, newName } = req.body;

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(oldName) ||
      !isNonEmptyString(newName)
    ) {
      authLogger.warn("Invalid request for snippet folder rename");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const existing = await db
        .select()
        .from(snippetFolders)
        .where(
          and(
            eq(snippetFolders.userId, userId),
            eq(snippetFolders.name, oldName),
          ),
        );

      if (existing.length === 0) {
        return res.status(404).json({ error: "Folder not found" });
      }

      const nameExists = await db
        .select()
        .from(snippetFolders)
        .where(
          and(
            eq(snippetFolders.userId, userId),
            eq(snippetFolders.name, newName),
          ),
        );

      if (nameExists.length > 0) {
        return res
          .status(409)
          .json({ error: "Folder with new name already exists" });
      }

      await db
        .update(snippetFolders)
        .set({ name: newName, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(
          and(
            eq(snippetFolders.userId, userId),
            eq(snippetFolders.name, oldName),
          ),
        );

      await db
        .update(snippets)
        .set({ folder: newName })
        .where(and(eq(snippets.userId, userId), eq(snippets.folder, oldName)));

      authLogger.success(
        `Snippet folder renamed: ${oldName} -> ${newName} by user ${userId}`,
        {
          operation: "snippet_folder_rename_success",
          userId,
          oldName,
          newName,
        },
      );

      res.json({ success: true, oldName, newName });
    } catch (err) {
      authLogger.error("Failed to rename snippet folder", err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to rename snippet folder",
      });
    }
  },
);

/**
 * @openapi
 * /snippets/folders/{name}:
 *   delete:
 *     summary: Delete a snippet folder
 *     description: Deletes a snippet folder and moves its snippets to the root.
 *     tags:
 *       - Snippets
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Snippet folder deleted successfully.
 *       400:
 *         description: Invalid request.
 *       500:
 *         description: Failed to delete snippet folder.
 */
router.delete(
  "/folders/:name",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const name = Array.isArray(req.params.name)
      ? req.params.name[0]
      : req.params.name;

    if (!isNonEmptyString(userId) || !name) {
      authLogger.warn("Invalid request for snippet folder delete");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const folderName = decodeURIComponent(name);

      await db
        .update(snippets)
        .set({ folder: null })
        .where(
          and(eq(snippets.userId, userId), eq(snippets.folder, folderName)),
        );

      await db
        .delete(snippetFolders)
        .where(
          and(
            eq(snippetFolders.userId, userId),
            eq(snippetFolders.name, folderName),
          ),
        );

      authLogger.success(
        `Snippet folder deleted: ${folderName} by user ${userId}`,
        {
          operation: "snippet_folder_delete_success",
          userId,
          name: folderName,
        },
      );

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete snippet folder", err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to delete snippet folder",
      });
    }
  },
);

/**
 * @openapi
 * /snippets/reorder:
 *   put:
 *     summary: Reorder snippets
 *     description: Bulk updates the order and folder of snippets.
 *     tags:
 *       - Snippets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               snippets:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     order:
 *                       type: integer
 *                     folder:
 *                       type: string
 *     responses:
 *       200:
 *         description: Snippets reordered successfully.
 *       400:
 *         description: Invalid request.
 *       500:
 *         description: Failed to reorder snippets.
 */
router.put(
  "/reorder",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { snippets: snippetUpdates } = req.body;

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for snippet reorder");
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (!Array.isArray(snippetUpdates) || snippetUpdates.length === 0) {
      authLogger.warn("Invalid snippet reorder data", {
        operation: "snippet_reorder",
        userId,
      });
      return res
        .status(400)
        .json({ error: "snippets array is required and must not be empty" });
    }

    try {
      for (const update of snippetUpdates) {
        const { id, order, folder } = update;

        if (!id || order === undefined) {
          continue;
        }

        const updateFields: Partial<{
          order: number;
          folder: string | null;
        }> = {
          order,
        };

        if (folder !== undefined) {
          updateFields.folder = folder?.trim() || null;
        }

        await db
          .update(snippets)
          .set(updateFields)
          .where(and(eq(snippets.id, id), eq(snippets.userId, userId)));
      }

      authLogger.success(`Snippets reordered by user ${userId}`, {
        operation: "snippet_reorder_success",
        userId,
        count: snippetUpdates.length,
      });

      res.json({ success: true, updated: snippetUpdates.length });
    } catch (err) {
      authLogger.error("Failed to reorder snippets", err);
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to reorder snippets",
      });
    }
  },
);

/**
 * @openapi
 * /snippets/execute:
 *   post:
 *     summary: Execute a snippet on a host
 *     description: Executes a snippet on a specified host.
 *     tags:
 *       - Snippets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               snippetId:
 *                 type: integer
 *               hostId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Snippet executed successfully.
 *       400:
 *         description: Snippet ID and Host ID are required.
 *       404:
 *         description: Snippet or host not found.
 *       500:
 *         description: Failed to execute snippet.
 */
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

      const { Client } = await import("ssh2");
      const { sshData, sshCredentials } = await import("../db/schema.js");

      const { SimpleDBOps } = await import("../../utils/simple-db-ops.js");

      const hostResult = await SimpleDBOps.select(
        db
          .select()
          .from(sshData)
          .where(
            and(eq(sshData.id, parseInt(hostId)), eq(sshData.userId, userId)),
          ),
        "ssh_data",
        userId,
      );

      if (hostResult.length === 0) {
        return res.status(404).json({ error: "Host not found" });
      }

      const host = hostResult[0];

      let password = host.password;
      let privateKey = host.key;
      let passphrase = host.key_password;
      let authType = host.authType;

      if (host.credentialId) {
        const credResult = await SimpleDBOps.select(
          db
            .select()
            .from(sshCredentials)
            .where(
              and(
                eq(sshCredentials.id, host.credentialId as number),
                eq(sshCredentials.userId, userId),
              ),
            ),
          "ssh_credentials",
          userId,
        );

        if (credResult.length > 0) {
          const cred = credResult[0];
          authType = (cred.auth_type || cred.authType || authType) as string;
          password = (cred.password || undefined) as string | undefined;
          privateKey = (cred.private_key || cred.key || undefined) as
            | string
            | undefined;
          passphrase = (cred.key_password || undefined) as string | undefined;
        }
      }

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

        if (authType === "password" && password) {
          config.password = password;
        } else if (authType === "key" && privateKey) {
          const cleanKey = (privateKey as string)
            .trim()
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");
          config.privateKey = Buffer.from(cleanKey, "utf8");
          if (passphrase) {
            config.passphrase = passphrase;
          }
        } else if (password) {
          config.password = password;
        } else if (privateKey) {
          const cleanKey = (privateKey as string)
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

/**
 * @openapi
 * /snippets:
 *   get:
 *     summary: Get all snippets
 *     description: Retrieves all snippets for the authenticated user.
 *     tags:
 *       - Snippets
 *     responses:
 *       200:
 *         description: A list of snippets.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to fetch snippets.
 */
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
        .orderBy(
          sql`CASE WHEN ${snippets.folder} IS NULL OR ${snippets.folder} = '' THEN 0 ELSE 1 END`,
          asc(snippets.folder),
          asc(snippets.order),
          desc(snippets.updatedAt),
        );

      res.json(result);
    } catch (err) {
      authLogger.error("Failed to fetch snippets", err);
      res.status(500).json({ error: "Failed to fetch snippets" });
    }
  },
);

/**
 * @openapi
 * /snippets/{id}:
 *   get:
 *     summary: Get a specific snippet
 *     description: Retrieves a specific snippet by its ID.
 *     tags:
 *       - Snippets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The requested snippet.
 *       400:
 *         description: Invalid request parameters.
 *       404:
 *         description: Snippet not found.
 *       500:
 *         description: Failed to fetch snippet.
 */
router.get(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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

/**
 * @openapi
 * /snippets:
 *   post:
 *     summary: Create a new snippet
 *     description: Creates a new snippet for the authenticated user.
 *     tags:
 *       - Snippets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *               description:
 *                 type: string
 *               folder:
 *                 type: string
 *               order:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Snippet created successfully.
 *       400:
 *         description: Name and content are required.
 *       500:
 *         description: Failed to create snippet.
 */
router.post(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, content, description, folder, order } = req.body;

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
      let snippetOrder = order;
      if (snippetOrder === undefined || snippetOrder === null) {
        const folderValue = folder?.trim() || "";
        const maxOrderResult = await db
          .select({ maxOrder: sql<number>`MAX(${snippets.order})` })
          .from(snippets)
          .where(
            and(
              eq(snippets.userId, userId),
              folderValue
                ? eq(snippets.folder, folderValue)
                : sql`(${snippets.folder} IS NULL OR ${snippets.folder} = '')`,
            ),
          );
        const maxOrder = maxOrderResult[0]?.maxOrder ?? -1;
        snippetOrder = maxOrder + 1;
      }

      const insertData = {
        userId,
        name: name.trim(),
        content: content.trim(),
        description: description?.trim() || null,
        folder: folder?.trim() || null,
        order: snippetOrder,
      };

      const result = await db.insert(snippets).values(insertData).returning();
      databaseLogger.info("Command snippet created", {
        operation: "snippet_create",
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

/**
 * @openapi
 * /snippets/{id}:
 *   put:
 *     summary: Update a snippet
 *     description: Updates a specific snippet by its ID.
 *     tags:
 *       - Snippets
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
 *               content:
 *                 type: string
 *               description:
 *                 type: string
 *               folder:
 *                 type: string
 *               order:
 *                 type: integer
 *     responses:
 *       200:
 *         description: The updated snippet.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Snippet not found.
 *       500:
 *         description: Failed to update snippet.
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
        folder: string | null;
        order: number;
      }> = {
        updatedAt: sql`CURRENT_TIMESTAMP`,
      };

      if (updateData.name !== undefined)
        updateFields.name = updateData.name.trim();
      if (updateData.content !== undefined)
        updateFields.content = updateData.content.trim();
      if (updateData.description !== undefined)
        updateFields.description = updateData.description?.trim() || null;
      if (updateData.folder !== undefined)
        updateFields.folder = updateData.folder?.trim() || null;
      if (updateData.order !== undefined) updateFields.order = updateData.order;

      await db
        .update(snippets)
        .set(updateFields)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      const updated = await db
        .select()
        .from(snippets)
        .where(eq(snippets.id, parseInt(id)));
      databaseLogger.info("Command snippet updated", {
        operation: "snippet_update",
        userId,
        snippetId: parseInt(id),
      });

      res.json(updated[0]);
    } catch (err) {
      authLogger.error("Failed to update snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to update snippet",
      });
    }
  },
);

/**
 * @openapi
 * /snippets/{id}:
 *   delete:
 *     summary: Delete a snippet
 *     description: Deletes a specific snippet by its ID.
 *     tags:
 *       - Snippets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Snippet deleted successfully.
 *       400:
 *         description: Invalid request.
 *       404:
 *         description: Snippet not found.
 *       500:
 *         description: Failed to delete snippet.
 */
router.delete(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

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
      databaseLogger.info("Command snippet deleted", {
        operation: "snippet_delete",
        userId,
        snippetId: parseInt(id),
      });

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to delete snippet",
      });
    }
  },
);

export default router;
