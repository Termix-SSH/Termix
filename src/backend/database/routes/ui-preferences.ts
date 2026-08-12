import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  createCurrentUiPreferenceRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import {
  defaultUiPreferences,
  sanitizeUiPreferences,
  UI_ONBOARDING_VERSION,
  type UiPreferences,
} from "../../../types/ui-preferences.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** Accounts younger than this are treated as new and get onboarding. */
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Existing users must never be ambushed by onboarding. A user with no
 * ui_preferences row who registered more than a day ago predates this feature,
 * so they are handed a completed onboarding state. This is a read-time default
 * rather than a migration write: nothing is persisted until the user actually
 * changes something, so it stays correct on a fresh database too.
 */
function withOnboardingBackfill(
  preferences: UiPreferences,
  registeredAt: string | null | undefined,
): UiPreferences {
  const registeredMs = registeredAt ? Date.parse(registeredAt) : Number.NaN;
  const isNewAccount =
    Number.isFinite(registeredMs) &&
    Date.now() - registeredMs < NEW_ACCOUNT_WINDOW_MS;

  if (isNewAccount) return preferences;

  return {
    ...preferences,
    onboarding: {
      ...preferences.onboarding,
      completedVersion: UI_ONBOARDING_VERSION,
    },
  };
}

/**
 * @openapi
 * /ui-preferences:
 *   get:
 *     summary: Get the UI complexity preferences for the current user
 *     description: Returns the current user's interface preset (simple, balanced, advanced or custom), their per-area overrides, and their onboarding state. A first-time GET returns defaults without writing a row; a row is only created once the user actually changes something via PUT. Users who registered before this feature existed are returned an already-completed onboarding state so they are never shown the first-run flow.
 *     tags:
 *       - UI Preferences
 *     responses:
 *       200:
 *         description: The current user's UI preferences.
 */
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const existing =
      await createCurrentUiPreferenceRepository().findByUserId(userId);

    if (existing) {
      return res.json({
        preferences: sanitizeUiPreferences(JSON.parse(existing.data)),
      });
    }

    const user = await createCurrentUserRepository().findById(userId);
    return res.json({
      preferences: withOnboardingBackfill(
        defaultUiPreferences(),
        user?.registeredAt,
      ),
    });
  } catch (e) {
    databaseLogger.error("Failed to get UI preferences", e, {
      operation: "get_ui_preferences",
      userId,
    });
    return res.status(500).json({ error: "Failed to get UI preferences" });
  }
});

/**
 * @openapi
 * /ui-preferences:
 *   put:
 *     summary: Update the UI complexity preferences for the current user
 *     description: Persists the current user's interface preset, per-area overrides and onboarding state as a single JSON document. Overrides are merged two levels deep, so a request only has to send the keys it changes. A null at a key clears that single override; a null at an area clears every override for that area; a null at overrides clears all of them.
 *     tags:
 *       - UI Preferences
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
    const repository = createCurrentUiPreferenceRepository();
    const existing = await repository.findByUserId(userId);
    const base = existing
      ? sanitizeUiPreferences(JSON.parse(existing.data))
      : defaultUiPreferences();

    const body = req.body as Record<string, unknown>;

    // Two levels of merging, with null meaning "clear this". A plain spread
    // could not express clearing an override, which the settings UI needs to
    // hand a knob back to the preset.
    const mergedOverrides: Record<string, Record<string, unknown>> = {
      ...(base.overrides as Record<string, Record<string, unknown>>),
    };

    if (body.overrides === null) {
      for (const area of Object.keys(mergedOverrides)) {
        delete mergedOverrides[area];
      }
    } else if (body.overrides && typeof body.overrides === "object") {
      for (const [area, patch] of Object.entries(
        body.overrides as Record<string, unknown>,
      )) {
        if (patch === null) {
          delete mergedOverrides[area];
          continue;
        }
        if (!patch || typeof patch !== "object") continue;

        const next = { ...(mergedOverrides[area] ?? {}) };
        for (const [key, value] of Object.entries(
          patch as Record<string, unknown>,
        )) {
          if (value === null) delete next[key];
          else next[key] = value;
        }
        mergedOverrides[area] = next;
      }
    }

    const merged = sanitizeUiPreferences({
      ...base,
      ...body,
      // Must come after the body spread, or a raw overrides payload would
      // clobber the merge above.
      overrides: mergedOverrides,
      onboarding: {
        ...base.onboarding,
        ...((body.onboarding as Record<string, unknown>) ?? {}),
      },
    });

    await repository.upsert(userId, JSON.stringify(merged));

    return res.json({ success: true, preferences: merged });
  } catch (e) {
    databaseLogger.error("Failed to update UI preferences", e, {
      operation: "update_ui_preferences",
      userId,
    });
    return res.status(500).json({ error: "Failed to update UI preferences" });
  }
});

export default router;
