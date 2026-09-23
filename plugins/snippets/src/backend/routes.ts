import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { SnippetRepository } from "./repository.js";
import { extractSnippetReorderUpdates } from "./reorder.js";
import {
  createSnippetExecutionResult,
  getSnippetExecutionTimeoutMs,
  resolveSnippetCommand,
} from "./execution.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function paramId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined ? NaN : parseInt(value, 10);
}

function sortSnippets<
  T extends { folder: string | null; order: number; updatedAt: string },
>(a: T, b: T): number {
  const aFolder = a.folder || "";
  const bFolder = b.folder || "";

  if (!aFolder && bFolder) return -1;
  if (aFolder && !bFolder) return 1;
  if (aFolder !== bFolder) return aFolder.localeCompare(bFolder);
  if (a.order !== b.order) return a.order - b.order;

  return b.updatedAt.localeCompare(a.updatedAt);
}

function actor(ctx: PluginContext): string {
  // Core's plugin router authenticates every request and runs it as that user.
  return ctx.currentActor() as string;
}

function logError(
  ctx: PluginContext,
  message: string,
  error: unknown,
  operation: string,
): void {
  ctx.log.error(
    `${message} (${operation})`,
    error instanceof Error ? error : new Error(String(error)),
  );
}

/**
 * Mounts every snippets route on the plugin's router, served at
 * /plugin-api/snippets. Most routes gate on their own permission; /execute
 * only needs auth plus an accessible snippet and host, matching how running a
 * snippet has never required a snippets.* grant.
 */
export function registerSnippetRoutes(
  router: Router,
  repo: SnippetRepository,
  ctx: PluginContext,
): void {
  async function getAccessibleSnippet(snippetId: number, userId: string) {
    const owned = await repo.findOwnedById(userId, snippetId);
    if (owned) return owned;

    const roleIds = await repo.listUserRoleIds(userId);
    return repo.findAccessibleSharedSnippet(snippetId, userId, roleIds);
  }

  /**
   * @openapi
   * /plugin-api/snippets/folders:
   *   get:
   *     summary: List the current user's snippet folders
   *     tags:
   *       - Snippets
   *     responses:
   *       200:
   *         description: A list of snippet folders.
   */
  router.get(
    "/folders",
    ctx.rbac.require("view") as never,
    async (_req: Request, res: Response) => {
      const userId = actor(ctx);
      try {
        res.json(await repo.listFolders(userId));
      } catch (err) {
        logError(
          ctx,
          "Failed to fetch snippet folders",
          err,
          "snippet_folder_list_failed",
        );
        res.status(500).json({ error: "Failed to fetch snippet folders" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/folders:
   *   post:
   *     summary: Create a snippet folder
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
   *         description: Snippet folder created.
   *       400:
   *         description: Folder name is required.
   *       409:
   *         description: A folder with this name already exists.
   */
  router.post(
    "/folders",
    ctx.rbac.require("create") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const { name, color, icon } = req.body ?? {};

      if (!isNonEmptyString(name)) {
        return res.status(400).json({ error: "Folder name is required" });
      }

      try {
        const created = await repo.createFolder(userId, name, color, icon);
        if (!created) {
          return res
            .status(409)
            .json({ error: "Folder with this name already exists" });
        }
        res.status(201).json(created);
      } catch (err) {
        logError(
          ctx,
          "Failed to create snippet folder",
          err,
          "snippet_folder_create_failed",
        );
        res.status(500).json({ error: "Failed to create snippet folder" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/folders/{name}/metadata:
   *   put:
   *     summary: Update a snippet folder's color or icon
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
   *         description: Snippet folder metadata updated.
   *       400:
   *         description: Invalid request.
   *       404:
   *         description: Folder not found.
   */
  router.put(
    "/folders/:name/metadata",
    ctx.rbac.require("edit") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const name = Array.isArray(req.params.name)
        ? req.params.name[0]
        : req.params.name;
      const { color, icon } = req.body ?? {};

      if (!name) return res.status(400).json({ error: "Invalid request" });

      try {
        const updated = await repo.updateFolderMetadata(
          userId,
          decodeURIComponent(name),
          color,
          icon,
        );
        if (!updated)
          return res.status(404).json({ error: "Folder not found" });
        res.json(updated);
      } catch (err) {
        logError(
          ctx,
          "Failed to update snippet folder metadata",
          err,
          "snippet_folder_metadata_update_failed",
        );
        res
          .status(500)
          .json({ error: "Failed to update snippet folder metadata" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/folders/rename:
   *   put:
   *     summary: Rename a snippet folder
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
   *         description: Folder renamed.
   *       400:
   *         description: Invalid request.
   *       404:
   *         description: Folder not found.
   *       409:
   *         description: A folder with the new name already exists.
   */
  router.put(
    "/folders/rename",
    ctx.rbac.require("edit") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const { oldName, newName } = req.body ?? {};

      if (!isNonEmptyString(oldName) || !isNonEmptyString(newName)) {
        return res.status(400).json({ error: "Invalid request" });
      }

      try {
        const result = await repo.renameFolder(userId, oldName, newName);
        if (result.status === "missing") {
          return res.status(404).json({ error: "Folder not found" });
        }
        if (result.status === "conflict") {
          return res
            .status(409)
            .json({ error: "Folder with new name already exists" });
        }
        res.json({ success: true, oldName, newName });
      } catch (err) {
        logError(
          ctx,
          "Failed to rename snippet folder",
          err,
          "snippet_folder_rename_failed",
        );
        res.status(500).json({ error: "Failed to rename snippet folder" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/folders/{name}:
   *   delete:
   *     summary: Delete a snippet folder
   *     description: Moves the folder's snippets to the root instead of deleting them.
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
   *         description: Snippet folder deleted.
   *       400:
   *         description: Invalid request.
   */
  router.delete(
    "/folders/:name",
    ctx.rbac.require("delete") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const name = Array.isArray(req.params.name)
        ? req.params.name[0]
        : req.params.name;

      if (!name) return res.status(400).json({ error: "Invalid request" });

      try {
        const folderName = decodeURIComponent(name);
        const deleted = await repo.deleteFolder(userId, folderName);
        await ctx.sync.recordTombstone(
          userId,
          "snippetFolders",
          deleted?.syncId,
        );
        res.json({ success: true });
      } catch (err) {
        logError(
          ctx,
          "Failed to delete snippet folder",
          err,
          "snippet_folder_delete_failed",
        );
        res.status(500).json({ error: "Failed to delete snippet folder" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/reorder:
   *   put:
   *     summary: Bulk update the order and folder of snippets
   *     description: Accepts a "snippets" array, and the legacy "updates" key.
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
   *         description: Snippets reordered.
   *       400:
   *         description: Invalid request.
   */
  router.put(
    "/reorder",
    ctx.rbac.require("edit") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const updates = extractSnippetReorderUpdates(req.body);

      if (!updates || updates.length === 0) {
        return res
          .status(400)
          .json({ error: "snippets array is required and must not be empty" });
      }

      try {
        await repo.reorderSnippets(userId, updates);
        res.json({ success: true, updated: updates.length });
      } catch (err) {
        logError(
          ctx,
          "Failed to reorder snippets",
          err,
          "snippet_reorder_failed",
        );
        res.status(500).json({ error: "Failed to reorder snippets" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/execute:
   *   post:
   *     summary: Run a snippet on a host over SSH
   *     description: Needs no snippets.* permission beyond an accessible snippet and host - running one has never required a separate grant.
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
   *               inputValues:
   *                 type: object
   *                 description: >
   *                   Resolved values for $INPUT_n placeholders, keyed by
   *                   "INPUT_n". $HOST/$USER/$PORT/$NAME are resolved
   *                   server-side from the target host.
   *                 additionalProperties:
   *                   type: string
   *     responses:
   *       200:
   *         description: Snippet executed.
   *       400:
   *         description: Snippet ID and host ID are required, or the snippet is a note.
   *       404:
   *         description: Snippet or host not found.
   */
  router.post("/execute", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const { snippetId, hostId, inputValues } = req.body ?? {};

    if (!snippetId || !hostId) {
      return res
        .status(400)
        .json({ error: "Snippet ID and Host ID are required" });
    }

    let connection: Awaited<ReturnType<typeof ctx.ssh.connect>> | undefined;
    try {
      const snippet = await getAccessibleSnippet(
        parseInt(snippetId, 10),
        userId,
      );
      if (!snippet) return res.status(404).json({ error: "Snippet not found" });

      if (snippet.isNote) {
        return res
          .status(400)
          .json({ error: "Notes cannot be executed on a host" });
      }

      connection = await ctx.ssh.connect(parseInt(hostId, 10), {
        purpose: "plugin",
        timeoutMs: 30000,
      });

      const resolvedCommand = resolveSnippetCommand(
        snippet.content,
        {
          ip: connection.host.ip,
          username: connection.host.username,
          port: connection.host.port,
          name: connection.host.name as string | undefined,
        },
        inputValues && typeof inputValues === "object" ? inputValues : {},
      );

      const client = connection.client as import("ssh2").Client;
      let output = "";
      let errorOutput = "";

      const result = await new Promise<
        ReturnType<typeof createSnippetExecutionResult>
      >((resolve, reject) => {
        const timeoutMs = getSnippetExecutionTimeoutMs();
        let timeout: NodeJS.Timeout | undefined;

        client.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        client.exec(resolvedCommand, (err, stream) => {
          if (err) return reject(err);

          if (timeoutMs) {
            timeout = setTimeout(() => {
              stream.close();
              reject(
                new Error(`Command execution timeout (${timeoutMs / 1000}s)`),
              );
            }, timeoutMs);
          }

          stream.on("close", (exitCode: number | null) => {
            clearTimeout(timeout);
            resolve(
              createSnippetExecutionResult(exitCode, output, errorOutput),
            );
          });
          stream.on("data", (data: Buffer) => {
            output += data.toString();
          });
          stream.stderr.on("data", (data: Buffer) => {
            errorOutput += data.toString();
          });
        });
      });

      res.json(result);
    } catch (err) {
      logError(ctx, "Failed to execute snippet", err, "snippet_execute_failed");
      res.status(500).json({ error: "Failed to execute snippet" });
    } finally {
      connection?.dispose();
    }
  });

  /**
   * @openapi
   * /plugin-api/snippets/export:
   *   get:
   *     summary: Export every snippet and folder as JSON
   *     tags:
   *       - Snippets
   *     responses:
   *       200:
   *         description: Export object with snippets and folders arrays.
   */
  router.get(
    "/export",
    ctx.rbac.require("view") as never,
    async (_req: Request, res: Response) => {
      const userId = actor(ctx);
      try {
        const allSnippets = await repo.listSnippetsForExport(userId);
        const allFolders = await repo.listFoldersForExport(userId);

        res.json({
          snippets: allSnippets.map((s) => ({
            name: s.name,
            content: s.content,
            description: s.description,
            folder: s.folder,
            order: s.order,
            hostFilter: s.hostFilter,
          })),
          folders: allFolders.map((f) => ({
            name: f.name,
            color: f.color,
            icon: f.icon,
          })),
        });
      } catch (err) {
        logError(
          ctx,
          "Failed to export snippets",
          err,
          "snippet_export_failed",
        );
        res.status(500).json({ error: "Failed to export snippets" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/bulk-import:
   *   post:
   *     summary: Import snippets and folders from JSON
   *     description: Existing folders are skipped. Existing snippets, matched by name and folder, are skipped or overwritten.
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
   */
  router.post(
    "/bulk-import",
    ctx.rbac.require("create") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const {
        snippets: snippetsToImport,
        folders: foldersToImport,
        overwrite,
      } = req.body ?? {};

      if (!Array.isArray(snippetsToImport) && !Array.isArray(foldersToImport)) {
        return res
          .status(400)
          .json({ error: "snippets or folders array is required" });
      }

      try {
        const results = await repo.bulkImport(
          userId,
          snippetsToImport,
          foldersToImport,
          !!overwrite,
        );
        res.json({ success: true, ...results });
      } catch (err) {
        logError(
          ctx,
          "Failed to bulk import snippets",
          err,
          "snippet_bulk_import_failed",
        );
        res.status(500).json({ error: "Failed to import snippets" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets:
   *   get:
   *     summary: List the current user's visible snippets
   *     description: Owned snippets plus snippets shared with the caller directly or through a role, tagged with isShared.
   *     tags:
   *       - Snippets
   *     responses:
   *       200:
   *         description: A list of snippets.
   */
  router.get(
    "/",
    ctx.rbac.require("view") as never,
    async (_req: Request, res: Response) => {
      const userId = actor(ctx);
      try {
        const owned = await repo.listOwnedSnippets(userId);
        const roleIds = await repo.listUserRoleIds(userId);
        const shared = await repo.listVisibleSharedSnippets(userId, roleIds);

        const visible = new Map<number, Record<string, unknown>>();
        for (const snippet of owned) {
          visible.set(snippet.id, { ...snippet, isShared: false });
        }
        for (const snippet of shared) {
          if (visible.has(snippet.id)) continue;
          visible.set(snippet.id, { ...snippet, isShared: true });
        }

        res.json(
          Array.from(visible.values()).sort((a, b) =>
            sortSnippets(
              a as { folder: string | null; order: number; updatedAt: string },
              b as { folder: string | null; order: number; updatedAt: string },
            ),
          ),
        );
      } catch (err) {
        logError(ctx, "Failed to fetch snippets", err, "snippet_list_failed");
        res.status(500).json({ error: "Failed to fetch snippets" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/shared:
   *   get:
   *     summary: List snippets shared with the current user
   *     description: Registered before /:id so the literal path "shared" is not swallowed by the id parameter.
   *     tags:
   *       - Snippets
   *     responses:
   *       200:
   *         description: Snippets shared with the caller.
   */
  router.get("/shared", async (_req: Request, res: Response) => {
    const userId = actor(ctx);
    try {
      const roleIds = await repo.listUserRoleIds(userId);
      const sharedSnippets = await repo.listSharedSnippets(userId, roleIds);
      res.json({ sharedSnippets });
    } catch (err) {
      logError(
        ctx,
        "Failed to get shared snippets",
        err,
        "shared_snippets_list_failed",
      );
      res.status(500).json({ error: "Failed to get shared snippets" });
    }
  });

  /**
   * @openapi
   * /plugin-api/snippets/{id}:
   *   get:
   *     summary: Get one snippet
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
   */
  router.get(
    "/:id",
    ctx.rbac.require("view") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const snippetId = parseInt(id, 10);

      if (isNaN(snippetId)) {
        return res.status(400).json({ error: "Invalid request parameters" });
      }

      try {
        const result = await getAccessibleSnippet(snippetId, userId);
        if (!result)
          return res.status(404).json({ error: "Snippet not found" });
        res.json(result);
      } catch (err) {
        logError(ctx, "Failed to fetch snippet", err, "snippet_get_failed");
        res.status(500).json({ error: "Failed to fetch snippet" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets:
   *   post:
   *     summary: Create a snippet
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
   *               isNote:
   *                 type: boolean
   *                 description: When true, the snippet is a note (copy/paste only, not directly executable on a host).
   *     responses:
   *       201:
   *         description: Snippet created.
   *       400:
   *         description: Name and content are required.
   */
  router.post(
    "/",
    ctx.rbac.require("create") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const { name, content, description, folder, order, hostFilter, isNote } =
        req.body ?? {};

      if (!isNonEmptyString(name) || !isNonEmptyString(content)) {
        return res.status(400).json({ error: "Name and content are required" });
      }

      try {
        const result = await repo.createSnippet(userId, {
          name,
          content,
          description,
          folder,
          order,
          hostFilter,
          isNote,
        });
        res.status(201).json(result);
      } catch (err) {
        logError(ctx, "Failed to create snippet", err, "snippet_create_failed");
        res.status(500).json({ error: "Failed to create snippet" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/{id}:
   *   put:
   *     summary: Update a snippet
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
   *               isNote:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: The updated snippet.
   *       400:
   *         description: Invalid request.
   *       404:
   *         description: Snippet not found.
   */
  router.put(
    "/:id",
    ctx.rbac.require("edit") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      if (!id) return res.status(400).json({ error: "Invalid request" });

      try {
        const result = await repo.updateSnippet(
          userId,
          parseInt(id, 10),
          req.body ?? {},
        );
        if (!result)
          return res.status(404).json({ error: "Snippet not found" });
        res.json(result.updated);
      } catch (err) {
        logError(ctx, "Failed to update snippet", err, "snippet_update_failed");
        res.status(500).json({ error: "Failed to update snippet" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/{id}:
   *   delete:
   *     summary: Delete a snippet
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
   *         description: Snippet deleted.
   *       400:
   *         description: Invalid request.
   *       404:
   *         description: Snippet not found.
   */
  router.delete(
    "/:id",
    ctx.rbac.require("delete") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      if (!id) return res.status(400).json({ error: "Invalid request" });

      try {
        const existing = await repo.deleteSnippet(userId, parseInt(id, 10));
        if (!existing)
          return res.status(404).json({ error: "Snippet not found" });
        await ctx.sync.recordTombstone(userId, "snippets", existing.syncId);
        res.json({ success: true });
      } catch (err) {
        logError(ctx, "Failed to delete snippet", err, "snippet_delete_failed");
        res.status(500).json({ error: "Failed to delete snippet" });
      }
    },
  );

  // Sharing (moved from core's /rbac/snippet* routes)

  /**
   * @openapi
   * /plugin-api/snippets/{id}/share:
   *   post:
   *     summary: Share a snippet with a user or role
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
   *               targetType:
   *                 type: string
   *                 enum: [user, role]
   *               targetUserId:
   *                 type: string
   *               targetRoleId:
   *                 type: integer
   *               expiresAt:
   *                 type: string
   *     responses:
   *       200:
   *         description: Snippet access updated.
   *       400:
   *         description: Invalid request.
   *       403:
   *         description: Not the snippet's owner.
   */
  router.post(
    "/:id/share",
    ctx.rbac.require("share") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const snippetId = parseInt(id, 10);
      if (isNaN(snippetId))
        return res.status(400).json({ error: "Invalid snippet ID" });

      const { targetType, targetUserId, targetRoleId, expiresAt } =
        req.body ?? {};
      if (targetType !== "user" && targetType !== "role") {
        return res
          .status(400)
          .json({ error: "targetType must be user or role" });
      }
      if (targetType === "user" && !isNonEmptyString(targetUserId)) {
        return res.status(400).json({ error: "targetUserId is required" });
      }
      if (targetType === "role" && typeof targetRoleId !== "number") {
        return res.status(400).json({ error: "targetRoleId is required" });
      }

      try {
        const snippet = await repo.findOwnedById(userId, snippetId);
        if (!snippet)
          return res.status(403).json({ error: "Not snippet owner" });

        await repo.upsertSnippetAccess({
          snippetId,
          grantedBy: userId,
          expiresAt: expiresAt ?? null,
          ...(targetType === "user"
            ? { targetType: "user" as const, targetUserId }
            : { targetType: "role" as const, targetRoleId }),
        });

        res.json({
          success: true,
          message: `Snippet shared successfully with ${targetType}`,
        });
      } catch (err) {
        logError(ctx, "Failed to share snippet", err, "snippet_share_failed");
        res.status(500).json({ error: "Failed to share snippet" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/folder/share:
   *   put:
   *     summary: Share every owned snippet in a folder
   *     description: Also shares snippets in subfolders ("Parent / Child").
   *     tags:
   *       - Snippets
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               folder:
   *                 type: string
   *               targetType:
   *                 type: string
   *                 enum: [user, role]
   *               targetUserId:
   *                 type: string
   *               targetRoleId:
   *                 type: integer
   *               expiresAt:
   *                 type: string
   *     responses:
   *       200:
   *         description: Snippet folder shared.
   *       400:
   *         description: Invalid request.
   */
  router.put(
    "/folder/share",
    ctx.rbac.require("share") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const { folder, targetType, targetUserId, targetRoleId, expiresAt } =
        req.body ?? {};

      if (!isNonEmptyString(folder)) {
        return res.status(400).json({ error: "folder is required" });
      }
      if (targetType !== "user" && targetType !== "role") {
        return res
          .status(400)
          .json({ error: "targetType must be user or role" });
      }
      if (targetType === "user" && !isNonEmptyString(targetUserId)) {
        return res.status(400).json({ error: "targetUserId is required" });
      }
      if (targetType === "role" && typeof targetRoleId !== "number") {
        return res.status(400).json({ error: "targetRoleId is required" });
      }

      try {
        const snippetsInFolder = await repo.listOwnedSnippetsInFolder(
          userId,
          folder,
        );
        for (const snippet of snippetsInFolder) {
          await repo.upsertSnippetAccess({
            snippetId: snippet.id,
            grantedBy: userId,
            expiresAt: expiresAt ?? null,
            ...(targetType === "user"
              ? { targetType: "user" as const, targetUserId }
              : { targetType: "role" as const, targetRoleId }),
          });
        }

        res.json({ success: true, snippetsShared: snippetsInFolder.length });
      } catch (err) {
        logError(
          ctx,
          "Failed to share snippet folder",
          err,
          "snippet_folder_share_failed",
        );
        res.status(500).json({ error: "Failed to share snippet folder" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/{id}/access/{accessId}:
   *   delete:
   *     summary: Revoke a snippet share
   *     tags:
   *       - Snippets
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
   *         description: Snippet access revoked.
   *       400:
   *         description: Invalid request.
   *       403:
   *         description: Not the snippet's owner.
   */
  router.delete(
    "/:id/access/:accessId",
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const snippetId = paramId(req.params.id);
      const accessId = paramId(req.params.accessId);
      if (isNaN(snippetId) || isNaN(accessId)) {
        return res.status(400).json({ error: "Invalid request" });
      }

      try {
        const snippet = await repo.findOwnedById(userId, snippetId);
        if (!snippet)
          return res.status(403).json({ error: "Not snippet owner" });

        await repo.revokeSnippetAccess(accessId, snippetId);
        res.json({ success: true, message: "Snippet access revoked" });
      } catch (err) {
        logError(
          ctx,
          "Failed to revoke snippet access",
          err,
          "snippet_access_revoke_failed",
        );
        res.status(500).json({ error: "Failed to revoke snippet access" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/snippets/{id}/access:
   *   get:
   *     summary: List who a snippet is shared with
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
   *         description: List of access grants.
   *       400:
   *         description: Invalid snippet ID.
   *       403:
   *         description: Not the snippet's owner.
   */
  router.get("/:id/access", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const snippetId = paramId(req.params.id);
    if (isNaN(snippetId))
      return res.status(400).json({ error: "Invalid snippet ID" });

    try {
      const snippet = await repo.findOwnedById(userId, snippetId);
      if (!snippet) return res.status(403).json({ error: "Not snippet owner" });

      res.json(await repo.listSnippetAccess(snippetId));
    } catch (err) {
      logError(
        ctx,
        "Failed to get snippet access list",
        err,
        "snippet_access_list_failed",
      );
      res.status(500).json({ error: "Failed to get snippet access list" });
    }
  });
}
