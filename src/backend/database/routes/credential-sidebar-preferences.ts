import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { createCurrentCredentialSidebarPreferenceRepository } from "../repositories/factory.js";
import {
  defaultCredentialSidebarPreferences,
  sanitizeCredentialSidebarPreferences,
} from "../../../types/credential-sidebar-preferences.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * @openapi
 * /credential-sidebar/preferences:
 *   get:
 *     summary: Get the credential sidebar preferences for the current user
 *     description: Returns the current user's saved credential sidebar preferences (sort, filters, open folders, display settings). Unlike /host-sidebar/preferences, there is no legacy-column migration to perform here — credentials never had exploded preference columns on userPreferences — so a first-time GET simply returns the defaults without writing a row; a row is only created once the user actually changes something via PUT.
 *     tags:
 *       - Credential Sidebar
 *     responses:
 *       200:
 *         description: The current user's credential sidebar preferences.
 */
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const existing =
      await createCurrentCredentialSidebarPreferenceRepository().findByUserId(
        userId,
      );

    if (existing) {
      const preferences = sanitizeCredentialSidebarPreferences(
        JSON.parse(existing.data),
      );
      return res.json({ preferences });
    }

    return res.json({ preferences: defaultCredentialSidebarPreferences() });
  } catch (e) {
    databaseLogger.error("Failed to get credential sidebar preferences", e, {
      operation: "get_credential_sidebar_preferences",
      userId,
    });
    return res
      .status(500)
      .json({ error: "Failed to get credential sidebar preferences" });
  }
});

/**
 * @openapi
 * /credential-sidebar/preferences:
 *   put:
 *     summary: Update the credential sidebar preferences for the current user
 *     description: Persists the current user's credential sidebar preferences (sort, filters, open folders, display settings) as a single JSON document.
 *     tags:
 *       - Credential Sidebar
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
      await createCurrentCredentialSidebarPreferenceRepository().findByUserId(
        userId,
      );
    const base = existing
      ? sanitizeCredentialSidebarPreferences(JSON.parse(existing.data))
      : defaultCredentialSidebarPreferences();

    const merged = sanitizeCredentialSidebarPreferences({
      ...base,
      ...req.body,
      display: { ...base.display, ...(req.body.display ?? {}) },
      sort: { ...base.sort, ...(req.body.sort ?? {}) },
      filters: { ...base.filters, ...(req.body.filters ?? {}) },
    });

    await createCurrentCredentialSidebarPreferenceRepository().upsert(
      userId,
      JSON.stringify(merged),
    );

    return res.json({ success: true, preferences: merged });
  } catch (e) {
    databaseLogger.error("Failed to update credential sidebar preferences", e, {
      operation: "update_credential_sidebar_preferences",
      userId,
    });
    return res
      .status(500)
      .json({ error: "Failed to update credential sidebar preferences" });
  }
});

export default router;
