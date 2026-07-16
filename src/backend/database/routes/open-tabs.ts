import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { sessionManager } from "../../hosts/terminal/session-manager.js";
import {
  getCurrentSettingValue,
  createCurrentOpenTabRepository,
} from "../repositories/factory.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * @openapi
 * /open-tabs:
 *   get:
 *     summary: Get all open tabs for the current user
 *     tags:
 *       - Open Tabs
 *     responses:
 *       200:
 *         description: List of open tabs ordered by tab_order.
 */
const DEFAULT_TAB_TTL_MINUTES = 30;

function getTabTtlMs(): number {
  try {
    const value = getCurrentSettingValue("terminal_session_timeout_minutes");
    if (value) {
      const minutes = parseInt(value, 10);
      if (!isNaN(minutes) && minutes > 0) return minutes * 60_000;
    }
  } catch {
    // DB not available, use default
  }
  return DEFAULT_TAB_TTL_MINUTES * 60_000;
}

// Legacy tab types that were renamed. Normalize on read so previously saved
// tabs still restore to the correct (renamed) tab type.
const LEGACY_TAB_TYPE_MAP: Record<string, string> = {
  stats: "host-metrics",
};

function normalizeTabType(tabType: string): string {
  return LEGACY_TAB_TYPE_MAP[tabType] ?? tabType;
}

router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const cutoff = new Date(Date.now() - getTabTtlMs()).toISOString();
    const tabs = await createCurrentOpenTabRepository().listRecentForUser(
      userId,
      cutoff,
    );
    return res.json(
      tabs.map((tab) => ({ ...tab, tabType: normalizeTabType(tab.tabType) })),
    );
  } catch (e) {
    databaseLogger.error("Failed to get open tabs", e, {
      operation: "get_open_tabs",
      userId,
    });
    return res.status(500).json({ error: "Failed to get open tabs" });
  }
});

/**
 * @openapi
 * /open-tabs:
 *   post:
 *     summary: Upsert a single open tab for the current user
 *     tags:
 *       - Open Tabs
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, tabType, label, tabOrder]
 *             properties:
 *               id:
 *                 type: string
 *               tabType:
 *                 type: string
 *               hostId:
 *                 type: integer
 *                 nullable: true
 *               label:
 *                 type: string
 *               tabOrder:
 *                 type: integer
 *               backendSessionId:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Tab upserted successfully.
 */
router.post("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { id, tabType, hostId, label, tabOrder, backendSessionId } =
    req.body as {
      id: string;
      tabType: string;
      hostId?: number | null;
      label: string;
      tabOrder: number;
      backendSessionId?: string | null;
    };

  if (!id || !tabType || !label) {
    return res
      .status(400)
      .json({ error: "id, tabType, and label are required" });
  }

  try {
    await createCurrentOpenTabRepository().upsertForUser(userId, {
      id,
      tabType,
      hostId,
      label,
      tabOrder,
      backendSessionId,
    });
    return res.json({ success: true });
  } catch (e) {
    databaseLogger.error("Failed to upsert open tab", e, {
      operation: "upsert_open_tab",
      userId,
      id,
    });
    return res.status(500).json({ error: "Failed to upsert open tab" });
  }
});

/**
 * @openapi
 * /open-tabs:
 *   put:
 *     summary: Bulk replace all open tabs for the current user
 *     tags:
 *       - Open Tabs
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tabs:
 *                 type: array
 *     responses:
 *       200:
 *         description: Tabs updated successfully.
 */
router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { tabs } = req.body as {
    tabs: Array<{
      id: string;
      tabType: string;
      hostId?: number | null;
      label: string;
      tabOrder: number;
      backendSessionId?: string | null;
    }>;
  };

  if (!Array.isArray(tabs)) {
    return res.status(400).json({ error: "tabs must be an array" });
  }

  try {
    await createCurrentOpenTabRepository().replaceForUser(userId, tabs);
    return res.json({ success: true });
  } catch (e) {
    databaseLogger.error("Failed to sync open tabs", e, {
      operation: "sync_open_tabs",
      userId,
    });
    return res.status(500).json({ error: "Failed to sync open tabs" });
  }
});

/**
 * @openapi
 * /open-tabs/{id}:
 *   patch:
 *     summary: Update a single open tab
 *     tags:
 *       - Open Tabs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tab updated successfully.
 *       404:
 *         description: Tab not found.
 */
router.patch("/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const id = String(req.params.id);
  const updates = req.body as Partial<{
    label: string;
    tabOrder: number;
    backendSessionId: string | null;
  }>;

  try {
    const updated = await createCurrentOpenTabRepository().updateForUser(
      userId,
      id,
      updates,
    );

    if (!updated) {
      return res.status(404).json({ error: "Tab not found" });
    }
    return res.json({ success: true });
  } catch (e) {
    databaseLogger.error("Failed to update open tab", e, {
      operation: "update_open_tab",
      userId,
      id,
    });
    return res.status(500).json({ error: "Failed to update open tab" });
  }
});

/**
 * @openapi
 * /open-tabs/{id}:
 *   delete:
 *     summary: Delete a single open tab
 *     tags:
 *       - Open Tabs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tab deleted successfully.
 */
router.delete("/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const id = String(req.params.id);

  try {
    await createCurrentOpenTabRepository().deleteForUser(userId, id);
    return res.json({ success: true });
  } catch (e) {
    databaseLogger.error("Failed to delete open tab", e, {
      operation: "delete_open_tab",
      userId,
      id,
    });
    return res.status(500).json({ error: "Failed to delete open tab" });
  }
});

/**
 * @openapi
 * /open-tabs/active-sessions:
 *   get:
 *     summary: Get all active backend sessions for the current user
 *     description: Returns live terminal sessions from the session manager. Used by the Active Connections panel and tab restore logic.
 *     tags:
 *       - Open Tabs
 *     responses:
 *       200:
 *         description: List of active sessions.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   sessionId:
 *                     type: string
 *                   hostId:
 *                     type: integer
 *                   hostName:
 *                     type: string
 *                   tabInstanceId:
 *                     type: string
 *                   isConnected:
 *                     type: boolean
 *                   createdAt:
 *                     type: number
 */
router.get(
  "/active-sessions",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const sessions = sessionManager.getUserSessions(userId);
      return res.json(
        sessions.map((s) => ({
          sessionId: s.id,
          hostId: s.hostId,
          hostName: s.hostName,
          tabInstanceId: s.attachedTabInstanceId ?? s.tabInstanceId ?? null,
          isConnected: s.isConnected,
          createdAt: s.createdAt,
        })),
      );
    } catch (e) {
      databaseLogger.error("Failed to get active sessions", e, {
        operation: "get_active_sessions",
        userId,
      });
      return res.status(500).json({ error: "Failed to get active sessions" });
    }
  },
);

export default router;
