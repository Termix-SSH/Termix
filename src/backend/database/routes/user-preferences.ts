import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { userPreferences } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * @openapi
 * /user-preferences:
 *   get:
 *     summary: Get preferences for the current user
 *     tags:
 *       - User Preferences
 *     responses:
 *       200:
 *         description: User preferences.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reopenTabsOnLogin:
 *                   type: boolean
 */
router.get("/", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rows = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .all();

    if (rows.length === 0) {
      return res.json({ reopenTabsOnLogin: false });
    }
    return res.json({ reopenTabsOnLogin: rows[0].reopenTabsOnLogin });
  } catch (e) {
    databaseLogger.error("Failed to get user preferences", e, { operation: "get_user_preferences", userId });
    return res.status(500).json({ error: "Failed to get user preferences" });
  }
});

/**
 * @openapi
 * /user-preferences:
 *   put:
 *     summary: Update preferences for the current user
 *     tags:
 *       - User Preferences
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reopenTabsOnLogin:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Preferences updated successfully.
 */
router.put("/", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { reopenTabsOnLogin } = req.body as { reopenTabsOnLogin?: boolean };

  if (typeof reopenTabsOnLogin !== "boolean") {
    return res.status(400).json({ error: "reopenTabsOnLogin must be a boolean" });
  }

  try {
    const existing = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .all();

    if (existing.length === 0) {
      db.insert(userPreferences).values({
        userId,
        reopenTabsOnLogin,
        updatedAt: new Date().toISOString(),
      }).run();
    } else {
      db.update(userPreferences)
        .set({ reopenTabsOnLogin, updatedAt: new Date().toISOString() })
        .where(eq(userPreferences.userId, userId))
        .run();
    }

    return res.json({ success: true, reopenTabsOnLogin });
  } catch (e) {
    databaseLogger.error("Failed to update user preferences", e, { operation: "update_user_preferences", userId });
    return res.status(500).json({ error: "Failed to update user preferences" });
  }
});

export default router;
