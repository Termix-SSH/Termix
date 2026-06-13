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

const pickPreferences = (row?: typeof userPreferences.$inferSelect) => ({
  reopenTabsOnLogin: row?.reopenTabsOnLogin ?? false,
  theme: row?.theme ?? null,
  fontSize: row?.fontSize ?? null,
  accentColor: row?.accentColor ?? null,
  language: row?.language ?? null,
  storageMode: row?.storageMode ?? "local",
  commandAutocomplete: row?.commandAutocomplete ?? null,
  commandPaletteEnabled: row?.commandPaletteEnabled ?? null,
  showHostTags: row?.showHostTags ?? null,
  hostTrayOnClick: row?.hostTrayOnClick ?? null,
  pinAppRail: row?.pinAppRail ?? null,
  foldersCollapsed: row?.foldersCollapsed ?? null,
  confirmSnippetExecution: row?.confirmSnippetExecution ?? null,
  disableUpdateCheck: row?.disableUpdateCheck ?? null,
  confirmTabClose: row?.confirmTabClose ?? null,
  hiddenRailTabs: row?.hiddenRailTabs ?? null,
});

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
 *                 theme:
 *                   type: string
 *                   nullable: true
 *                 fontSize:
 *                   type: string
 *                   nullable: true
 *                 accentColor:
 *                   type: string
 *                   nullable: true
 *                 language:
 *                   type: string
 *                   nullable: true
 *                 storageMode:
 *                   type: string
 *                   nullable: true
 *                 commandAutocomplete:
 *                   type: boolean
 *                   nullable: true
 *                 commandPaletteEnabled:
 *                   type: boolean
 *                   nullable: true
 *                 showHostTags:
 *                   type: boolean
 *                   nullable: true
 *                 hostTrayOnClick:
 *                   type: boolean
 *                   nullable: true
 *                 pinAppRail:
 *                   type: boolean
 *                   nullable: true
 *                 foldersCollapsed:
 *                   type: boolean
 *                   nullable: true
 *                 confirmSnippetExecution:
 *                   type: boolean
 *                   nullable: true
 *                 disableUpdateCheck:
 *                   type: boolean
 *                   nullable: true
 *                 confirmTabClose:
 *                   type: boolean
 *                   nullable: true
 *                 hiddenRailTabs:
 *                   type: string
 *                   nullable: true
 */
router.get("/", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rows = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .all();

    return res.json(pickPreferences(rows[0]));
  } catch (e) {
    databaseLogger.error("Failed to get user preferences", e, {
      operation: "get_user_preferences",
      userId,
    });
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
 *               theme:
 *                 type: string
 *               fontSize:
 *                 type: string
 *               accentColor:
 *                 type: string
 *               language:
 *                 type: string
 *               storageMode:
 *                 type: string
 *               commandAutocomplete:
 *                 type: boolean
 *               commandPaletteEnabled:
 *                 type: boolean
 *               showHostTags:
 *                 type: boolean
 *               hostTrayOnClick:
 *                 type: boolean
 *               pinAppRail:
 *                 type: boolean
 *               foldersCollapsed:
 *                 type: boolean
 *               confirmSnippetExecution:
 *                 type: boolean
 *               disableUpdateCheck:
 *                 type: boolean
 *               confirmTabClose:
 *                 type: boolean
 *               hiddenRailTabs:
 *                 type: string
 *     responses:
 *       200:
 *         description: Preferences updated successfully.
 */
router.put("/", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const {
    reopenTabsOnLogin,
    theme,
    fontSize,
    accentColor,
    language,
    storageMode,
    commandAutocomplete,
    commandPaletteEnabled,
    showHostTags,
    hostTrayOnClick,
    pinAppRail,
    foldersCollapsed,
    confirmSnippetExecution,
    disableUpdateCheck,
    confirmTabClose,
    hiddenRailTabs,
  } = req.body as {
    reopenTabsOnLogin?: boolean;
    theme?: string | null;
    fontSize?: string | null;
    accentColor?: string | null;
    language?: string | null;
    storageMode?: string | null;
    commandAutocomplete?: boolean | null;
    commandPaletteEnabled?: boolean | null;
    showHostTags?: boolean | null;
    hostTrayOnClick?: boolean | null;
    pinAppRail?: boolean | null;
    foldersCollapsed?: boolean | null;
    confirmSnippetExecution?: boolean | null;
    disableUpdateCheck?: boolean | null;
    confirmTabClose?: boolean | null;
    hiddenRailTabs?: string | null;
  };

  const updates: Partial<typeof userPreferences.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (reopenTabsOnLogin !== undefined) {
    if (typeof reopenTabsOnLogin !== "boolean") {
      return res
        .status(400)
        .json({ error: "reopenTabsOnLogin must be a boolean" });
    }
    updates.reopenTabsOnLogin = reopenTabsOnLogin;
  }

  for (const [key, value] of Object.entries({
    theme,
    fontSize,
    accentColor,
    language,
    storageMode,
    hiddenRailTabs,
  })) {
    if (value !== undefined && value !== null && typeof value !== "string") {
      return res.status(400).json({ error: `${key} must be a string` });
    }
  }

  const boolFields: Record<string, boolean | null | undefined> = {
    commandAutocomplete,
    commandPaletteEnabled,
    showHostTags,
    hostTrayOnClick,
    pinAppRail,
    foldersCollapsed,
    confirmSnippetExecution,
    disableUpdateCheck,
    confirmTabClose,
  };
  for (const [key, value] of Object.entries(boolFields)) {
    if (value !== undefined && value !== null && typeof value !== "boolean") {
      return res.status(400).json({ error: `${key} must be a boolean` });
    }
  }

  if (theme !== undefined) updates.theme = theme;
  if (fontSize !== undefined) updates.fontSize = fontSize;
  if (accentColor !== undefined) updates.accentColor = accentColor;
  if (language !== undefined) updates.language = language;
  if (storageMode !== undefined) updates.storageMode = storageMode;
  if (hiddenRailTabs !== undefined) updates.hiddenRailTabs = hiddenRailTabs;
  if (commandAutocomplete !== undefined)
    updates.commandAutocomplete = commandAutocomplete;
  if (commandPaletteEnabled !== undefined)
    updates.commandPaletteEnabled = commandPaletteEnabled;
  if (showHostTags !== undefined) updates.showHostTags = showHostTags;
  if (hostTrayOnClick !== undefined) updates.hostTrayOnClick = hostTrayOnClick;
  if (pinAppRail !== undefined) updates.pinAppRail = pinAppRail;
  if (foldersCollapsed !== undefined)
    updates.foldersCollapsed = foldersCollapsed;
  if (confirmSnippetExecution !== undefined)
    updates.confirmSnippetExecution = confirmSnippetExecution;
  if (disableUpdateCheck !== undefined)
    updates.disableUpdateCheck = disableUpdateCheck;
  if (confirmTabClose !== undefined) updates.confirmTabClose = confirmTabClose;

  if (Object.keys(updates).length === 1) {
    return res.status(400).json({ error: "No preferences provided" });
  }

  try {
    const existing = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .all();

    if (existing.length === 0) {
      db.insert(userPreferences)
        .values({
          userId,
          ...updates,
        })
        .run();
    } else {
      db.update(userPreferences)
        .set(updates)
        .where(eq(userPreferences.userId, userId))
        .run();
    }

    return res.json({ success: true, ...updates });
  } catch (e) {
    databaseLogger.error("Failed to update user preferences", e, {
      operation: "update_user_preferences",
      userId,
    });
    return res.status(500).json({ error: "Failed to update user preferences" });
  }
});

export default router;
