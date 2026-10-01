import type { AuthenticatedRequest } from "../../../types/index.js";
import express, { type Request, type Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { createCurrentUserPreferenceRepository } from "../repositories/factory.js";
import type {
  UserPreferenceRecord,
  UserPreferenceUpdate,
} from "../repositories/user-preference-repository.js";
import { isValidKeybinding } from "./keybinding-validation.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const pickPreferences = (row?: UserPreferenceRecord | null) => ({
  reopenTabsOnLogin: row?.reopenTabsOnLogin ?? false,
  theme: row?.theme ?? null,
  fontSize: row?.fontSize ?? null,
  accentColor: row?.accentColor ?? null,
  language: row?.language ?? null,
  storageMode: row?.storageMode ?? "cloud",
  commandPaletteEnabled: row?.commandPaletteEnabled ?? null,
  showHostTags: row?.showHostTags ?? null,
  hostTrayOnClick: row?.hostTrayOnClick ?? null,
  pinAppRail: row?.pinAppRail ?? null,
  expandAppRailOnHover: row?.expandAppRailOnHover ?? null,
  showPinAppRailButton: row?.showPinAppRailButton ?? null,
  disableUpdateCheck: row?.disableUpdateCheck ?? null,
  confirmTabClose: row?.confirmTabClose ?? null,
  hiddenRailTabs: row?.hiddenRailTabs ?? null,
  compactHostView: row?.compactHostView ?? null,
  statusColorScheme: row?.statusColorScheme ?? null,
  customKeybindings: row?.customKeybindings ?? null,
});

/**
 * @openapi
 * /user-preferences:
 *   get:
 *     summary: Get preferences for the current user
 *     description: showHostTags, hostTrayOnClick, compactHostView and statusColorScheme are legacy fields, kept here read-only for backward compatibility; the authoritative copy is GET /host-sidebar/preferences.
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
 *                 expandAppRailOnHover:
 *                   type: boolean
 *                   nullable: true
 *                 showPinAppRailButton:
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
 *                 compactHostView:
 *                   type: boolean
 *                   nullable: true
 *                 statusColorScheme:
 *                   type: string
 *                   nullable: true
 *                 customKeybindings:
 *                   type: string
 *                   nullable: true
 *                   description: JSON-encoded array of the user's custom keybindings. An action's type is one of the shell's own or one a plugin declares in contributes.keybindingActions.
 */
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const preferences =
      await createCurrentUserPreferenceRepository().findByUserId(userId);

    return res.json(pickPreferences(preferences));
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
 *     description: showHostTags, hostTrayOnClick, compactHostView and statusColorScheme are no longer accepted here -- they moved to PUT /host-sidebar/preferences as part of the sidebar redesign. Values that moved into a feature's own user settings are ignored too.
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
 *               commandPaletteEnabled:
 *                 type: boolean
 *               pinAppRail:
 *                 type: boolean
 *               expandAppRailOnHover:
 *                 type: boolean
 *               showPinAppRailButton:
 *                 type: boolean
 *               disableUpdateCheck:
 *                 type: boolean
 *               confirmTabClose:
 *                 type: boolean
 *               hiddenRailTabs:
 *                 type: string
 *               customKeybindings:
 *                 type: string
 *                 description: JSON-encoded array of the user's custom keybindings. Each action is checked against the shell's own types and the parameters a plugin declares for its type.
 *     responses:
 *       200:
 *         description: Preferences updated successfully.
 */
router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const {
    reopenTabsOnLogin,
    theme,
    fontSize,
    accentColor,
    language,
    storageMode,
    commandPaletteEnabled,
    pinAppRail,
    expandAppRailOnHover,
    showPinAppRailButton,
    disableUpdateCheck,
    confirmTabClose,
    hiddenRailTabs,
    customKeybindings,
  } = req.body as {
    reopenTabsOnLogin?: boolean;
    theme?: string | null;
    fontSize?: string | null;
    accentColor?: string | null;
    language?: string | null;
    storageMode?: string | null;
    commandPaletteEnabled?: boolean | null;
    pinAppRail?: boolean | null;
    expandAppRailOnHover?: boolean | null;
    showPinAppRailButton?: boolean | null;
    disableUpdateCheck?: boolean | null;
    confirmTabClose?: boolean | null;
    hiddenRailTabs?: string | null;
    customKeybindings?: string | null;
  };
  // showHostTags, hostTrayOnClick, compactHostView, statusColorScheme are no
  // longer writable here -- they moved to /host-sidebar/preferences as of the
  // sidebar redesign. The columns stay in the table (read once as a
  // migration seed by that route) but this endpoint silently ignores them if
  // a stale client still sends them. The same goes for the preferences that
  // moved into a plugin's own user settings.

  const updates: UserPreferenceUpdate = {
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
    customKeybindings,
  })) {
    if (value !== undefined && value !== null && typeof value !== "string") {
      return res.status(400).json({ error: `${key} must be a string` });
    }
  }

  if (customKeybindings !== undefined && customKeybindings !== null) {
    let parsedKeybindings: unknown;
    try {
      parsedKeybindings = JSON.parse(customKeybindings);
    } catch {
      return res
        .status(400)
        .json({ error: "customKeybindings must be a JSON-encoded array" });
    }
    if (!Array.isArray(parsedKeybindings) || parsedKeybindings.length > 200) {
      return res.status(400).json({
        error: "customKeybindings must be a JSON array of at most 200 bindings",
      });
    }
    if (!parsedKeybindings.every(isValidKeybinding)) {
      return res.status(400).json({
        error:
          "Each custom keybinding must have an id, enabled flag, valid combo, and valid action",
      });
    }
  }

  const boolFields: Record<string, boolean | null | undefined> = {
    commandPaletteEnabled,
    pinAppRail,
    expandAppRailOnHover,
    showPinAppRailButton,
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
  if (commandPaletteEnabled !== undefined)
    updates.commandPaletteEnabled = commandPaletteEnabled;
  if (pinAppRail !== undefined) updates.pinAppRail = pinAppRail;
  if (expandAppRailOnHover !== undefined)
    updates.expandAppRailOnHover = expandAppRailOnHover;
  if (showPinAppRailButton !== undefined)
    updates.showPinAppRailButton = showPinAppRailButton;
  if (disableUpdateCheck !== undefined)
    updates.disableUpdateCheck = disableUpdateCheck;
  if (confirmTabClose !== undefined) updates.confirmTabClose = confirmTabClose;
  if (customKeybindings !== undefined)
    updates.customKeybindings = customKeybindings;

  if (Object.keys(updates).length === 1) {
    return res.status(400).json({ error: "No preferences provided" });
  }

  try {
    await createCurrentUserPreferenceRepository().upsert(userId, updates);

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
