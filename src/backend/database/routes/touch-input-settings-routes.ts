import type { RequestHandler, Router } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import {
  normalizeTouchInputSettings,
  TOUCH_INPUT_SETTING_KEY,
  validateTouchInputSettingsUpdate,
} from "../../../types/touch-input-settings.js";
import { authLogger } from "../../utils/logger.js";
import {
  createCurrentSettingsRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";

async function readSettings() {
  const raw = await createCurrentSettingsRepository().get(
    TOUCH_INPUT_SETTING_KEY,
  );
  if (!raw) return normalizeTouchInputSettings(null);
  try {
    return normalizeTouchInputSettings(JSON.parse(raw));
  } catch {
    return normalizeTouchInputSettings(null);
  }
}

export function registerTouchInputSettingsRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  router.get("/touch-input-settings", authenticateJWT, async (_req, res) => {
    try {
      res.json(await readSettings());
    } catch (error) {
      authLogger.error("Failed to get touch input settings", error);
      res.status(500).json({ error: "Failed to get touch input settings" });
    }
  });

  router.patch("/touch-input-settings", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const user = userId
        ? await createCurrentUserRepository().findById(userId)
        : null;
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const validationError = validateTouchInputSettingsUpdate(req.body);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      const current = await readSettings();
      const merged = { ...current, ...req.body };
      const mergedValidationError = validateTouchInputSettingsUpdate(merged);
      if (mergedValidationError) {
        return res.status(400).json({ error: mergedValidationError });
      }
      const next = normalizeTouchInputSettings(merged);
      await createCurrentSettingsRepository().set(
        TOUCH_INPUT_SETTING_KEY,
        JSON.stringify(next),
      );
      res.json(next);
    } catch (error) {
      authLogger.error("Failed to update touch input settings", error);
      res.status(500).json({ error: "Failed to update touch input settings" });
    }
  });
}
