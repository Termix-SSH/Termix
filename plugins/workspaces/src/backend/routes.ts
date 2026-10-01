import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { WorkspaceRecord, WorkspaceRepository } from "./repository.js";

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function parseWorkspaceId(raw: unknown): number | null {
  const id = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isInteger(id) ? id : null;
}

function isValidPayload(val: unknown): val is Record<string, unknown> {
  return (
    typeof val === "object" &&
    val !== null &&
    Array.isArray((val as Record<string, unknown>).tabs)
  );
}

function serialize(record: WorkspaceRecord) {
  let payload: unknown;
  try {
    payload = JSON.parse(record.payload || "{}");
  } catch {
    payload = { version: 1, tabs: [] };
  }
  const tabs = Array.isArray((payload as { tabs?: unknown[] })?.tabs)
    ? (payload as { tabs: unknown[] }).tabs
    : [];

  return {
    ...record,
    payload,
    tabCount: tabs.length,
  };
}

function actor(ctx: PluginContext): string {
  // Core's plugin router authenticates every request and runs it as that user.
  return ctx.currentActor() as string;
}

function logError(
  ctx: PluginContext,
  message: string,
  error: unknown,
  details: { operation: string; workspaceId?: number },
): void {
  const target =
    details.workspaceId !== undefined ? ` ${details.workspaceId}` : "";
  ctx.log.error(
    `${message}${target} (${details.operation})`,
    error instanceof Error ? error : new Error(String(error)),
  );
}

/**
 * Mounts the workspace routes on the plugin's router, which core serves at
 * /plugin-api/workspaces with auth in front. Every route needs workspaces.use,
 * so an admin can hide the feature per role.
 */
export function registerWorkspaceRoutes(
  router: Router,
  repo: WorkspaceRepository,
  ctx: PluginContext,
): void {
  router.use(ctx.rbac.require("use") as never);

  /**
   * @openapi
   * /plugin-api/workspaces:
   *   get:
   *     summary: List the current user's saved workspaces
   *     description: Returns every manual workspace plus the single auto-maintained "Last Session" workspace, each with a computed tabCount.
   *     tags:
   *       - Workspaces
   *     responses:
   *       200:
   *         description: List of workspaces.
   */
  router.get("/", async (req: Request, res: Response) => {
    const userId = actor(ctx);

    try {
      const records = await repo.listByUser(userId);
      res.json(records.map(serialize));
    } catch (err) {
      logError(ctx, "Failed to list workspaces", err, {
        operation: "workspace_list_failed",
      });
      res.status(500).json({ error: "Failed to list workspaces" });
    }
  });

  /**
   * @openapi
   * /plugin-api/workspaces:
   *   post:
   *     summary: Save the current tab arrangement as a new named workspace
   *     tags:
   *       - Workspaces
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
   *               payload:
   *                 type: object
   *     responses:
   *       200:
   *         description: Workspace created.
   *       400:
   *         description: Invalid request body.
   */
  router.post("/", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const { name, color, icon, payload } = req.body ?? {};

    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: "Workspace name is required" });
    }
    if (!isValidPayload(payload)) {
      return res
        .status(400)
        .json({ error: "payload with a tabs array is required" });
    }

    try {
      const created = await repo.create(userId, {
        name: name.trim(),
        color: isNonEmptyString(color) ? color : null,
        icon: isNonEmptyString(icon) ? icon : null,
        payload: JSON.stringify(payload),
      });
      res.json(serialize(created));
    } catch (err) {
      logError(ctx, "Failed to create workspace", err, {
        operation: "workspace_create_failed",
      });
      res.status(500).json({ error: "Failed to create workspace" });
    }
  });

  /**
   * @openapi
   * /plugin-api/workspaces/last-session:
   *   get:
   *     summary: Fetch the auto-maintained "Last Session" workspace
   *     description: Returns null if the current session has never been auto-saved yet.
   *     tags:
   *       - Workspaces
   *     responses:
   *       200:
   *         description: The Last Session workspace, or null.
   */
  router.get("/last-session", async (req: Request, res: Response) => {
    const userId = actor(ctx);

    try {
      const record = await repo.findLastSession(userId);
      res.json(record ? serialize(record) : null);
    } catch (err) {
      logError(ctx, "Failed to fetch last session workspace", err, {
        operation: "workspace_last_session_get_failed",
      });
      res.status(500).json({ error: "Failed to fetch last session workspace" });
    }
  });

  /**
   * @openapi
   * /plugin-api/workspaces/last-session:
   *   put:
   *     summary: Upsert the auto-maintained "Last Session" workspace
   *     description: Always overwrites the single Last Session row for the caller - never creates a second one. Called by the frontend's debounced auto-save effect.
   *     tags:
   *       - Workspaces
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               payload:
   *                 type: object
   *     responses:
   *       200:
   *         description: Last Session workspace saved.
   *       400:
   *         description: Invalid request body.
   */
  router.put("/last-session", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const { payload } = req.body ?? {};

    if (!isValidPayload(payload)) {
      return res
        .status(400)
        .json({ error: "payload with a tabs array is required" });
    }

    try {
      const saved = await repo.upsertLastSession(
        userId,
        JSON.stringify(payload),
      );
      res.json(serialize(saved));
    } catch (err) {
      logError(ctx, "Failed to save last session workspace", err, {
        operation: "workspace_last_session_save_failed",
      });
      res.status(500).json({ error: "Failed to save last session workspace" });
    }
  });

  /**
   * @openapi
   * /plugin-api/workspaces/{id}:
   *   patch:
   *     summary: Rename or recolor a workspace
   *     description: Does not accept a payload - use PUT /workspaces/{id}/content to overwrite a workspace's saved tab arrangement. Rejects the Last Session workspace.
   *     tags:
   *       - Workspaces
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Workspace updated.
   *       400:
   *         description: Invalid request, or target is the Last Session workspace.
   *       404:
   *         description: Workspace not found.
   */
  router.patch("/:id", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    const { name, color, icon } = req.body ?? {};
    if (name !== undefined && !isNonEmptyString(name)) {
      return res.status(400).json({ error: "Workspace name cannot be empty" });
    }

    try {
      const updated = await repo.update(userId, id, {
        name: name !== undefined ? name.trim() : undefined,
        color,
        icon,
      });

      if (!updated) {
        return res.status(404).json({ error: "Workspace not found" });
      }
      res.json(serialize(updated));
    } catch (err) {
      logError(ctx, "Failed to update workspace", err, {
        operation: "workspace_update_failed",
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to update workspace" });
    }
  });

  /**
   * @openapi
   * /plugin-api/workspaces/{id}/content:
   *   put:
   *     summary: Overwrite a workspace's saved tab arrangement with a new payload
   *     description: Used by "Update with current" in the Workspaces panel. Rejects the Last Session workspace.
   *     tags:
   *       - Workspaces
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
   *               payload:
   *                 type: object
   *     responses:
   *       200:
   *         description: Workspace content updated.
   *       400:
   *         description: Invalid request body.
   *       404:
   *         description: Workspace not found.
   */
  router.put("/:id/content", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    const { payload } = req.body ?? {};
    if (!isValidPayload(payload)) {
      return res
        .status(400)
        .json({ error: "payload with a tabs array is required" });
    }

    try {
      const updated = await repo.updateContent(
        userId,
        id,
        JSON.stringify(payload),
      );

      if (!updated) {
        return res.status(404).json({ error: "Workspace not found" });
      }
      res.json(serialize(updated));
    } catch (err) {
      logError(ctx, "Failed to update workspace content", err, {
        operation: "workspace_content_update_failed",
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to update workspace content" });
    }
  });

  /**
   * @openapi
   * /plugin-api/workspaces/{id}/duplicate:
   *   post:
   *     summary: Duplicate a workspace's content and color/icon under a new name
   *     tags:
   *       - Workspaces
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
   *     responses:
   *       200:
   *         description: New workspace created from the duplicate.
   *       404:
   *         description: Workspace not found.
   */
  router.post("/:id/duplicate", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseWorkspaceId(req.params.id);
    const { name } = req.body ?? {};
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: "Workspace name is required" });
    }

    try {
      const source = await repo.findById(userId, id);
      if (!source) {
        return res.status(404).json({ error: "Workspace not found" });
      }

      const created = await repo.create(userId, {
        name: name.trim(),
        color: source.color,
        icon: source.icon,
        payload: source.payload,
      });
      res.json(serialize(created));
    } catch (err) {
      logError(ctx, "Failed to duplicate workspace", err, {
        operation: "workspace_duplicate_failed",
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to duplicate workspace" });
    }
  });

  /**
   * @openapi
   * /plugin-api/workspaces/{id}/set-default:
   *   post:
   *     summary: Mark a workspace as the restore-on-login default
   *     description: Clears isDefault on any other workspace for the caller. Idempotent if the target is already the default. Rejects the Last Session workspace.
   *     tags:
   *       - Workspaces
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Workspace set as default.
   *       404:
   *         description: Workspace not found.
   */
  router.post("/:id/set-default", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    try {
      const updated = await repo.setDefault(userId, id);
      if (!updated) {
        return res.status(404).json({ error: "Workspace not found" });
      }
      res.json(serialize(updated));
    } catch (err) {
      logError(ctx, "Failed to set default workspace", err, {
        operation: "workspace_set_default_failed",
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to set default workspace" });
    }
  });

  /**
   * @openapi
   * /plugin-api/workspaces/{id}/unset-default:
   *   post:
   *     summary: Remove a workspace as the restore-on-login default
   *     description: Idempotent if the target is not currently the default. Rejects the Last Session workspace.
   *     tags:
   *       - Workspaces
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Workspace unset as default.
   *       404:
   *         description: Workspace not found.
   */
  router.post("/:id/unset-default", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    try {
      const updated = await repo.unsetDefault(userId, id);
      if (!updated) {
        return res.status(404).json({ error: "Workspace not found" });
      }
      res.json(serialize(updated));
    } catch (err) {
      logError(ctx, "Failed to unset default workspace", err, {
        operation: "workspace_unset_default_failed",
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to unset default workspace" });
    }
  });

  /**
   * @openapi
   * /plugin-api/workspaces/{id}/apply:
   *   post:
   *     summary: Fetch a workspace to apply and mark it as just used
   *     description: Returns the full workspace with its payload parsed, and touches lastUsedAt server-side so the caller does not need a second round trip.
   *     tags:
   *       - Workspaces
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The workspace to apply.
   *       404:
   *         description: Workspace not found.
   */
  router.post("/:id/apply", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    try {
      const record = await repo.findById(userId, id);
      if (!record) {
        return res.status(404).json({ error: "Workspace not found" });
      }

      await repo.touchLastUsed(userId, id);
      res.json(serialize(record));
    } catch (err) {
      logError(ctx, "Failed to apply workspace", err, {
        operation: "workspace_apply_failed",
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to apply workspace" });
    }
  });

  /**
   * @openapi
   * /plugin-api/workspaces/{id}:
   *   delete:
   *     summary: Delete a workspace
   *     description: Rejects the Last Session workspace, which is not user-deletable.
   *     tags:
   *       - Workspaces
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Workspace deleted.
   *       404:
   *         description: Workspace not found.
   */
  router.delete("/:id", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    try {
      const deleted = await repo.delete(userId, id);
      if (!deleted) {
        return res.status(404).json({ error: "Workspace not found" });
      }
      res.json({ success: true });
    } catch (err) {
      logError(ctx, "Failed to delete workspace", err, {
        operation: "workspace_delete_failed",
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to delete workspace" });
    }
  });
}
