import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  createCurrentHostSidebarPreferenceRepository,
  createCurrentUserPreferenceRepository,
} from "../repositories/factory.js";
import {
  defaultHostSidebarPreferences,
  sanitizeHostSidebarPreferences,
} from "../../../types/host-sidebar-preferences.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * @openapi
 * /host-sidebar/preferences:
 *   get:
 *     summary: Get the host sidebar preferences for the current user
 *     description: Returns the current user's saved sidebar preferences (sort, group, filters, open folders, display settings). On first access, seeds the preferences from the legacy per-column user-preferences fields (showHostTags, hostTrayOnClick, compactHostView, statusColorScheme) so existing settings are not lost.
 *     tags:
 *       - Host Sidebar
 *     responses:
 *       200:
 *         description: The current user's sidebar preferences.
 */
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const existing =
      await createCurrentHostSidebarPreferenceRepository().findByUserId(userId);

    if (existing) {
      const preferences = sanitizeHostSidebarPreferences(
        JSON.parse(existing.data),
      );
      return res.json({ preferences });
    }

    const legacy =
      await createCurrentUserPreferenceRepository().findByUserId(userId);
    const defaults = defaultHostSidebarPreferences();
    const seeded = sanitizeHostSidebarPreferences({
      ...defaults,
      display: {
        ...defaults.display,
        showTags: legacy?.showHostTags ?? defaults.display.showTags,
        trayTrigger:
          legacy?.hostTrayOnClick == null
            ? defaults.display.trayTrigger
            : legacy.hostTrayOnClick
              ? "click"
              : "hover",
        density:
          legacy?.compactHostView == null
            ? defaults.display.density
            : legacy.compactHostView
              ? "compact"
              : "comfortable",
        statusColorScheme:
          legacy?.statusColorScheme ?? defaults.display.statusColorScheme,
      },
    });

    await createCurrentHostSidebarPreferenceRepository().upsert(
      userId,
      JSON.stringify(seeded),
    );

    return res.json({ preferences: seeded });
  } catch (e) {
    databaseLogger.error("Failed to get host sidebar preferences", e, {
      operation: "get_host_sidebar_preferences",
      userId,
    });
    return res
      .status(500)
      .json({ error: "Failed to get host sidebar preferences" });
  }
});

/**
 * @openapi
 * /host-sidebar/preferences:
 *   put:
 *     summary: Update the host sidebar preferences for the current user
 *     description: Persists the current user's sidebar preferences (sort, group, filters, open folders, display settings) as a single JSON document.
 *     tags:
 *       - Host Sidebar
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Preferences updated successfully.
 *       400:
 *         description: Invalid preferences payload.
 */
router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Invalid preferences payload" });
  }

  try {
    const existing =
      await createCurrentHostSidebarPreferenceRepository().findByUserId(userId);
    const base = existing
      ? sanitizeHostSidebarPreferences(JSON.parse(existing.data))
      : defaultHostSidebarPreferences();

    const merged = sanitizeHostSidebarPreferences({
      ...base,
      ...req.body,
      display: { ...base.display, ...(req.body.display ?? {}) },
      sort: { ...base.sort, ...(req.body.sort ?? {}) },
      filters: { ...base.filters, ...(req.body.filters ?? {}) },
    });

    await createCurrentHostSidebarPreferenceRepository().upsert(
      userId,
      JSON.stringify(merged),
    );

    return res.json({ success: true, preferences: merged });
  } catch (e) {
    databaseLogger.error("Failed to update host sidebar preferences", e, {
      operation: "update_host_sidebar_preferences",
      userId,
    });
    return res
      .status(500)
      .json({ error: "Failed to update host sidebar preferences" });
  }
});

export default router;
