import type { AuthenticatedRequest } from "../../../types/index.js";
import express, { type Request, type Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import {
  createCurrentSettingsRepository,
  createCurrentUserPreferenceRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import { getPluginRuntime } from "../../plugins/index.js";
import {
  LAYOUT_SETTING,
  LOOK_ID_PATTERN,
  THEME_SETTING,
  installedLayoutIds,
  resolveDefaultLook,
  safeLayoutForced,
  unavailableLooks,
} from "../../plugins/looks.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

async function adminDefaults() {
  const settings = createCurrentSettingsRepository();
  return {
    layout: await settings.get(LAYOUT_SETTING),
    theme: await settings.get(THEME_SETTING),
  };
}

/**
 * @openapi
 * /user-preferences/look:
 *   get:
 *     summary: Get the layout and theme to show the current user
 *     description: The user's own choice, the admin defaults (a layout no installed plugin brings reads as null), the default look of the bundled plugins, whether TERMIX_SAFE_LAYOUT forces the repair view, and installed layout or theme plugins that could not load. The browser resolves the final look from these.
 *     tags:
 *       - User Preferences
 *     responses:
 *       200:
 *         description: What the look is chosen from.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 layoutId:
 *                   type: string
 *                   nullable: true
 *                 themeId:
 *                   type: string
 *                   nullable: true
 *                 defaults:
 *                   type: object
 *                   description: Admin defaults, null where unset.
 *                   properties:
 *                     layout:
 *                       type: string
 *                       nullable: true
 *                     theme:
 *                       type: string
 *                       nullable: true
 *                 defaultLook:
 *                   type: object
 *                   description: The default-look plugin's layout and theme, null where none is installed.
 *                   properties:
 *                     layout:
 *                       type: string
 *                       nullable: true
 *                     theme:
 *                       type: string
 *                       nullable: true
 *                 safeLayout:
 *                   type: boolean
 *                 unavailable:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       version:
 *                         type: string
 *                         nullable: true
 *                       layouts:
 *                         type: array
 *                         items:
 *                           type: string
 *                       themes:
 *                         type: array
 *                         items:
 *                           type: string
 *                       error:
 *                         type: string
 */
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const preferences =
      await createCurrentUserPreferenceRepository().findByUserId(userId);
    const { loader } = getPluginRuntime();
    const installed = installedLayoutIds(loader);
    const known = (id: string | null | undefined) =>
      id && installed.has(id) ? id : null;
    const defaults = await adminDefaults();
    res.json({
      layoutId: known(preferences?.layoutId),
      themeId: preferences?.themeId ?? null,
      defaults: { ...defaults, layout: known(defaults.layout) },
      defaultLook: resolveDefaultLook(loader),
      safeLayout: safeLayoutForced(),
      unavailable: unavailableLooks(loader),
    });
  } catch (error) {
    databaseLogger.error("Failed to get the look", error, {
      operation: "get_look",
      userId,
    });
    res.status(500).json({ error: "Failed to get the look" });
  }
});

/**
 * @openapi
 * /user-preferences/look/defaults:
 *   put:
 *     summary: Set the default layout and theme (admin only)
 *     description: What everyone sees until they choose their own. Null clears a default so the default look applies.
 *     tags:
 *       - User Preferences
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               layout:
 *                 type: string
 *                 nullable: true
 *               theme:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: The defaults now in effect.
 *       400:
 *         description: Not a layout or theme id.
 *       403:
 *         description: Not an admin.
 */
router.put(
  "/defaults",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const actor = await createCurrentUserRepository().findById(userId);
      if (!actor?.isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const body = (req.body ?? {}) as { layout?: unknown; theme?: unknown };
      const changes: Array<[string, unknown]> = [
        [LAYOUT_SETTING, body.layout],
        [THEME_SETTING, body.theme],
      ];
      for (const [key, value] of changes) {
        if (
          value !== undefined &&
          value !== null &&
          (typeof value !== "string" || !LOOK_ID_PATTERN.test(value))
        ) {
          return res
            .status(400)
            .json({ error: `${key} must be a layout or theme id, or null` });
        }
      }
      const settings = createCurrentSettingsRepository();
      for (const [key, value] of changes) {
        if (value === undefined) continue;
        if (value === null) await settings.delete(key);
        else await settings.set(key, value as string);
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "update_default_look",
        resourceType: "setting",
        details: JSON.stringify({ layout: body.layout, theme: body.theme }),
        ipAddress,
        userAgent,
        success: true,
      });
      res.json(await adminDefaults());
    } catch (error) {
      databaseLogger.error("Failed to set the default look", error, {
        operation: "set_default_look",
        userId,
      });
      res.status(500).json({ error: "Failed to set the default look" });
    }
  },
);

export default router;
