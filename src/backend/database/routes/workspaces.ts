import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { createCurrentWorkspaceRepository } from "../repositories/factory.js";
import type { WorkspaceRecord } from "../repositories/workspace-repository.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

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

/**
 * @openapi
 * /workspaces:
 *   get:
 *     summary: List the current user's saved workspaces
 *     description: Returns every manual workspace plus the single auto-maintained "Last Session" workspace, each with a computed tabCount.
 *     tags:
 *       - Workspaces
 *     responses:
 *       200:
 *         description: List of workspaces.
 */
router.get(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    try {
      const records =
        await createCurrentWorkspaceRepository().listByUser(userId);
      res.json(records.map(serialize));
    } catch (err) {
      databaseLogger.error("Failed to list workspaces", err, {
        operation: "workspace_list_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to list workspaces" });
    }
  },
);

/**
 * @openapi
 * /workspaces:
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
router.post(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
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
      const created = await createCurrentWorkspaceRepository().create(userId, {
        name: name.trim(),
        color: isNonEmptyString(color) ? color : null,
        icon: isNonEmptyString(icon) ? icon : null,
        payload: JSON.stringify(payload),
      });
      res.json(serialize(created));
    } catch (err) {
      databaseLogger.error("Failed to create workspace", err, {
        operation: "workspace_create_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to create workspace" });
    }
  },
);

/**
 * @openapi
 * /workspaces/last-session:
 *   get:
 *     summary: Fetch the auto-maintained "Last Session" workspace
 *     description: Returns null if the current session has never been auto-saved yet.
 *     tags:
 *       - Workspaces
 *     responses:
 *       200:
 *         description: The Last Session workspace, or null.
 */
router.get(
  "/last-session",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    try {
      const record =
        await createCurrentWorkspaceRepository().findLastSession(userId);
      res.json(record ? serialize(record) : null);
    } catch (err) {
      databaseLogger.error("Failed to fetch last session workspace", err, {
        operation: "workspace_last_session_get_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to fetch last session workspace" });
    }
  },
);

/**
 * @openapi
 * /workspaces/last-session:
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
router.put(
  "/last-session",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { payload } = req.body ?? {};

    if (!isValidPayload(payload)) {
      return res
        .status(400)
        .json({ error: "payload with a tabs array is required" });
    }

    try {
      const saved = await createCurrentWorkspaceRepository().upsertLastSession(
        userId,
        JSON.stringify(payload),
      );
      res.json(serialize(saved));
    } catch (err) {
      databaseLogger.error("Failed to save last session workspace", err, {
        operation: "workspace_last_session_save_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to save last session workspace" });
    }
  },
);

/**
 * @openapi
 * /workspaces/{id}:
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
router.patch(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    const { name, color, icon } = req.body ?? {};
    if (name !== undefined && !isNonEmptyString(name)) {
      return res.status(400).json({ error: "Workspace name cannot be empty" });
    }

    try {
      const updated = await createCurrentWorkspaceRepository().update(
        userId,
        id,
        {
          name: name !== undefined ? name.trim() : undefined,
          color,
          icon,
        },
      );

      if (!updated) {
        return res.status(404).json({ error: "Workspace not found" });
      }
      res.json(serialize(updated));
    } catch (err) {
      databaseLogger.error("Failed to update workspace", err, {
        operation: "workspace_update_failed",
        userId,
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to update workspace" });
    }
  },
);

/**
 * @openapi
 * /workspaces/{id}/content:
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
router.put(
  "/:id/content",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
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
      const updated = await createCurrentWorkspaceRepository().updateContent(
        userId,
        id,
        JSON.stringify(payload),
      );

      if (!updated) {
        return res.status(404).json({ error: "Workspace not found" });
      }
      res.json(serialize(updated));
    } catch (err) {
      databaseLogger.error("Failed to update workspace content", err, {
        operation: "workspace_content_update_failed",
        userId,
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to update workspace content" });
    }
  },
);

/**
 * @openapi
 * /workspaces/{id}/duplicate:
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
router.post(
  "/:id/duplicate",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseWorkspaceId(req.params.id);
    const { name } = req.body ?? {};
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: "Workspace name is required" });
    }

    try {
      const repository = createCurrentWorkspaceRepository();
      const source = await repository.findById(userId, id);
      if (!source) {
        return res.status(404).json({ error: "Workspace not found" });
      }

      const created = await repository.create(userId, {
        name: name.trim(),
        color: source.color,
        icon: source.icon,
        payload: source.payload,
      });
      res.json(serialize(created));
    } catch (err) {
      databaseLogger.error("Failed to duplicate workspace", err, {
        operation: "workspace_duplicate_failed",
        userId,
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to duplicate workspace" });
    }
  },
);

/**
 * @openapi
 * /workspaces/{id}/set-default:
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
router.post(
  "/:id/set-default",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    try {
      const updated = await createCurrentWorkspaceRepository().setDefault(
        userId,
        id,
      );
      if (!updated) {
        return res.status(404).json({ error: "Workspace not found" });
      }
      res.json(serialize(updated));
    } catch (err) {
      databaseLogger.error("Failed to set default workspace", err, {
        operation: "workspace_set_default_failed",
        userId,
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to set default workspace" });
    }
  },
);

/**
 * @openapi
 * /workspaces/{id}/unset-default:
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
router.post(
  "/:id/unset-default",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    try {
      const updated = await createCurrentWorkspaceRepository().unsetDefault(
        userId,
        id,
      );
      if (!updated) {
        return res.status(404).json({ error: "Workspace not found" });
      }
      res.json(serialize(updated));
    } catch (err) {
      databaseLogger.error("Failed to unset default workspace", err, {
        operation: "workspace_unset_default_failed",
        userId,
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to unset default workspace" });
    }
  },
);

/**
 * @openapi
 * /workspaces/{id}/apply:
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
router.post(
  "/:id/apply",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    try {
      const repository = createCurrentWorkspaceRepository();
      const record = await repository.findById(userId, id);
      if (!record) {
        return res.status(404).json({ error: "Workspace not found" });
      }

      await repository.touchLastUsed(userId, id);
      res.json(serialize(record));
    } catch (err) {
      databaseLogger.error("Failed to apply workspace", err, {
        operation: "workspace_apply_failed",
        userId,
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to apply workspace" });
    }
  },
);

/**
 * @openapi
 * /workspaces/{id}:
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
router.delete(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseWorkspaceId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    try {
      const deleted = await createCurrentWorkspaceRepository().delete(
        userId,
        id,
      );
      if (!deleted) {
        return res.status(404).json({ error: "Workspace not found" });
      }
      res.json({ success: true });
    } catch (err) {
      databaseLogger.error("Failed to delete workspace", err, {
        operation: "workspace_delete_failed",
        userId,
        workspaceId: id,
      });
      res.status(500).json({ error: "Failed to delete workspace" });
    }
  },
);

export default router;
