import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { authLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { SSH_ALGORITHMS } from "../../utils/ssh-algorithms.js";
import { extractSnippetReorderUpdates } from "./snippets-reorder.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import {
  createCurrentHostResolutionRepository,
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentSnippetRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";

const router = express.Router();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

async function getUserRoleIds(userId: string): Promise<number[]> {
  return createCurrentRoleRepository().listUserRoleIds(userId);
}

async function getActorUsername(userId: string): Promise<string> {
  const user = await createCurrentUserRepository().findById(userId);
  return user?.username ?? userId;
}

function sortSnippets<
  T extends { folder: string | null; order: number; updatedAt: string },
>(a: T, b: T) {
  const aFolder = a.folder || "";
  const bFolder = b.folder || "";

  if (!aFolder && bFolder) return -1;
  if (aFolder && !bFolder) return 1;
  if (aFolder !== bFolder) return aFolder.localeCompare(bFolder);
  if (a.order !== b.order) return a.order - b.order;

  return b.updatedAt.localeCompare(a.updatedAt);
}

async function getAccessibleSnippet(snippetId: number, userId: string) {
  const owned = await createCurrentSnippetRepository().findOwnedById(
    userId,
    snippetId,
  );

  if (owned) {
    return owned;
  }

  const roleIds = await getUserRoleIds(userId);
  return createCurrentRbacAccessRepository().findAccessibleSharedSnippet(
    snippetId,
    userId,
    roleIds,
  );
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
      const result = await createCurrentSnippetRepository().listFolders(userId);

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
      const created = await createCurrentSnippetRepository().createFolder(
        userId,
        name,
        color,
        icon,
      );

      if (!created) {
        return res
          .status(409)
          .json({ error: "Folder with this name already exists" });
      }

      authLogger.success(`Snippet folder created: ${name} by user ${userId}`, {
        operation: "snippet_folder_create_success",
        userId,
        name,
      });

      res.status(201).json(created);
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
      const decodedName = decodeURIComponent(name);
      const updated =
        await createCurrentSnippetRepository().updateFolderMetadata(
          userId,
          decodedName,
          color,
          icon,
        );

      if (!updated) {
        return res.status(404).json({ error: "Folder not found" });
      }

      authLogger.success(
        `Snippet folder metadata updated: ${name} by user ${userId}`,
        {
          operation: "snippet_folder_metadata_update_success",
          userId,
          name,
        },
      );

      res.json(updated);
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
      const result = await createCurrentSnippetRepository().renameFolder(
        userId,
        oldName,
        newName,
      );

      if (result.status === "missing") {
        return res.status(404).json({ error: "Folder not found" });
      }

      if (result.status === "conflict") {
        return res
          .status(409)
          .json({ error: "Folder with new name already exists" });
      }

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

      await createCurrentSnippetRepository().deleteFolder(userId, folderName);

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
 *     description: Bulk updates the order and folder of snippets. Accepts
 *       `snippets` and the legacy `updates` payload key.
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
    const snippetUpdates = extractSnippetReorderUpdates(req.body);

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for snippet reorder");
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (!snippetUpdates || snippetUpdates.length === 0) {
      authLogger.warn("Invalid snippet reorder data", {
        operation: "snippet_reorder",
        userId,
      });
      return res
        .status(400)
        .json({ error: "snippets array is required and must not be empty" });
    }

    try {
      await createCurrentSnippetRepository().reorderSnippets(
        userId,
        snippetUpdates,
      );

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
      const snippet = await getAccessibleSnippet(parseInt(snippetId), userId);

      if (!snippet) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      const { Client } = await import("ssh2");
      const repository = createCurrentHostResolutionRepository();
      const host = await repository.findHostById(parseInt(hostId), userId);

      if (!host || host.userId !== userId) {
        return res.status(404).json({ error: "Host not found" });
      }

      let password = host.password;
      let privateKey = host.key;
      let passphrase = host.keyPassword;
      let authType = host.authType;

      if (host.credentialId) {
        const cred = await repository.findCredentialByIdForUser(
          host.credentialId as number,
          userId,
        );

        if (cred) {
          authType = (cred.authType || authType) as string;
          password = (cred.password || undefined) as string | undefined;
          privateKey = (cred.privateKey || cred.key || undefined) as
            | string
            | undefined;
          passphrase = (cred.keyPassword || undefined) as string | undefined;
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

        const config: Record<string, unknown> = {
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
            cipher: SSH_ALGORITHMS.cipher,
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
 * /snippets/export:
 *   get:
 *     summary: Export all snippets and folders as JSON
 *     description: Returns all snippets and snippet folders for the authenticated user as a JSON export.
 *     tags:
 *       - Snippets
 *     responses:
 *       200:
 *         description: Export object containing snippets and folders arrays.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to export snippets.
 */
router.get(
  "/export",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for snippet export");
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const snippetRepository = createCurrentSnippetRepository();
      const allSnippets = await snippetRepository.listSnippetsForExport(userId);
      const allFolders = await snippetRepository.listFoldersForExport(userId);

      const exportedSnippets = allSnippets.map((s) => ({
        name: s.name,
        content: s.content,
        description: s.description,
        folder: s.folder,
        order: s.order,
        hostFilter: s.hostFilter,
      }));

      const exportedFolders = allFolders.map((f) => ({
        name: f.name,
        color: f.color,
        icon: f.icon,
      }));

      authLogger.success(`Snippets exported by user ${userId}`, {
        operation: "snippet_export",
        userId,
        snippetCount: exportedSnippets.length,
        folderCount: exportedFolders.length,
      });

      res.json({ snippets: exportedSnippets, folders: exportedFolders });
    } catch (err) {
      authLogger.error("Failed to export snippets", err);
      res.status(500).json({ error: "Failed to export snippets" });
    }
  },
);

/**
 * @openapi
 * /snippets/bulk-import:
 *   post:
 *     summary: Bulk import snippets and folders from JSON
 *     description: Imports snippets and folders. Existing folders are skipped; existing snippets (matched by name+folder) can be skipped or overwritten.
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
 *               folders:
 *                 type: array
 *               overwrite:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Import results with counts.
 *       400:
 *         description: Invalid request body.
 *       500:
 *         description: Failed to import snippets.
 */
router.post(
  "/bulk-import",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const {
      snippets: snippetsToImport,
      folders: foldersToImport,
      overwrite,
    } = req.body;

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (!Array.isArray(snippetsToImport) && !Array.isArray(foldersToImport)) {
      return res
        .status(400)
        .json({ error: "snippets or folders array is required" });
    }

    try {
      const results = await createCurrentSnippetRepository().bulkImport(
        userId,
        snippetsToImport,
        foldersToImport,
        !!overwrite,
      );

      authLogger.success(`Snippets bulk-imported by user ${userId}`, {
        operation: "snippet_bulk_import",
        userId,
        ...results,
      });

      res.json({ success: true, ...results });
    } catch (err) {
      authLogger.error("Failed to bulk import snippets", err);
      res.status(500).json({ error: "Failed to import snippets" });
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
      const ownedSnippets =
        await createCurrentSnippetRepository().listOwnedSnippets(userId);

      const roleIds = await getUserRoleIds(userId);
      const sharedSnippets =
        await createCurrentRbacAccessRepository().listVisibleSharedSnippets(
          userId,
          roleIds,
        );

      const visibleSnippets = new Map<number, Record<string, unknown>>();
      for (const snippet of ownedSnippets) {
        visibleSnippets.set(snippet.id, { ...snippet, isShared: false });
      }
      for (const snippet of sharedSnippets) {
        if (visibleSnippets.has(snippet.id)) continue;
        visibleSnippets.set(snippet.id, { ...snippet, isShared: true });
      }

      const result = Array.from(visibleSnippets.values()).sort((a, b) =>
        sortSnippets(
          a as { folder: string | null; order: number; updatedAt: string },
          b as { folder: string | null; order: number; updatedAt: string },
        ),
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
      const result = await getAccessibleSnippet(snippetId, userId);

      if (!result) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      res.json(result);
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
    const { name, content, description, folder, order, hostFilter } = req.body;

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
      const result = await createCurrentSnippetRepository().createSnippet(
        userId,
        {
          name,
          content,
          description,
          folder,
          order,
          hostFilter,
        },
      );
      databaseLogger.info("Command snippet created", {
        operation: "snippet_create",
        userId,
        snippetId: result.id,
        name,
      });

      const { ipAddress: scIp, userAgent: scUa } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "create_snippet",
        resourceType: "snippet",
        resourceId: String(result.id),
        resourceName: name,
        ipAddress: scIp,
        userAgent: scUa,
        success: true,
      });

      res.status(201).json(result);
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
      const snippetId = parseInt(id);
      const result = await createCurrentSnippetRepository().updateSnippet(
        userId,
        snippetId,
        updateData,
      );

      if (!result) {
        return res.status(404).json({ error: "Snippet not found" });
      }
      databaseLogger.info("Command snippet updated", {
        operation: "snippet_update",
        userId,
        snippetId,
      });

      const { ipAddress: suIp, userAgent: suUa } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "update_snippet",
        resourceType: "snippet",
        resourceId: id,
        resourceName: result.existing.name,
        ipAddress: suIp,
        userAgent: suUa,
        success: true,
      });

      res.json(result.updated);
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
      const snippetId = parseInt(id);
      const existing = await createCurrentSnippetRepository().deleteSnippet(
        userId,
        snippetId,
      );

      if (!existing) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      databaseLogger.info("Command snippet deleted", {
        operation: "snippet_delete",
        userId,
        snippetId,
      });

      const { ipAddress: sdIp, userAgent: sdUa } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "delete_snippet",
        resourceType: "snippet",
        resourceId: id,
        resourceName: existing.name,
        ipAddress: sdIp,
        userAgent: sdUa,
        success: true,
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
