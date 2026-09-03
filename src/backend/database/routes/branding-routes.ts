import type { Request, RequestHandler, Response, Router } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { createCurrentSettingsRepository } from "../repositories/factory.js";
import {
  BRANDING_KEYS,
  parseBrandingAppName,
  parseBrandingLogoDataUrl,
  parseBrandingTagline,
  resolveBrandingSettings,
} from "./branding-settings.js";

const PATCHABLE_FIELDS = ["appName", "tagline", "logo"] as const;
type PatchableField = (typeof PATCHABLE_FIELDS)[number];

function invalidField(res: Response, field: string): void {
  res.status(400).json({
    error: `Invalid value for ${field}`,
    code: "BRANDING_SETTINGS_INVALID",
    field,
  });
}

/**
 * Validates a PATCH body and returns the settings-table writes/deletes it
 * implies, or null after the response has already been failed with a 400.
 * `logo: null` clears the custom logo (falls back to the bundled default).
 */
async function buildBrandingWrites(
  body: unknown,
  res: Response,
): Promise<{
  writes: Array<{ key: string; value: string }>;
  deletes: string[];
} | null> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    res.status(400).json({
      error: "Invalid request body",
      code: "BRANDING_SETTINGS_INVALID",
    });
    return null;
  }

  for (const field of Object.keys(body)) {
    if (!(PATCHABLE_FIELDS as readonly string[]).includes(field)) {
      res.status(400).json({
        error: `Unknown setting field: ${field}`,
        code: "BRANDING_SETTINGS_UNKNOWN_FIELD",
        field,
      });
      return null;
    }
  }

  const input = body as Partial<Record<PatchableField, unknown>>;
  const writes: Array<{ key: string; value: string }> = [];
  const deletes: string[] = [];

  if (input.appName !== undefined) {
    const appName = parseBrandingAppName(input.appName);
    if (appName === null) {
      invalidField(res, "appName");
      return null;
    }
    writes.push({ key: BRANDING_KEYS.appName, value: appName });
  }

  if (input.tagline !== undefined) {
    const tagline = parseBrandingTagline(input.tagline);
    if (tagline === null) {
      invalidField(res, "tagline");
      return null;
    }
    writes.push({ key: BRANDING_KEYS.tagline, value: tagline });
  }

  if (input.logo !== undefined) {
    if (input.logo === null) {
      deletes.push(BRANDING_KEYS.logo);
    } else {
      const logo = await parseBrandingLogoDataUrl(input.logo);
      if (logo === null) {
        invalidField(res, "logo");
        return null;
      }
      writes.push({ key: BRANDING_KEYS.logo, value: logo });
    }
  }

  return { writes, deletes };
}

export function registerBrandingRoutes(
  router: Router,
  requireAdmin: RequestHandler,
): void {
  /**
   * @openapi
   * /users/branding:
   *   get:
   *     summary: Get white-label branding
   *     description: Returns the effective app name, tagline and logo. Public (no auth) so the pre-login screen and app bootstrap can apply branding before any session exists.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Effective branding settings.
   *       500:
   *         description: Failed to load branding settings.
   */
  router.get("/branding", async (_req: Request, res: Response) => {
    try {
      const settings = await resolveBrandingSettings(
        createCurrentSettingsRepository(),
      );
      res.json(settings);
    } catch (err) {
      databaseLogger.error("Failed to load branding settings", err);
      res.status(500).json({ error: "Failed to load branding settings" });
    }
  });

  /**
   * @openapi
   * /users/branding:
   *   patch:
   *     summary: Update white-label branding (admin only)
   *     description: Persists a partial update to appName, tagline and/or logo (a PNG/JPEG/WEBP data URL; pass null to clear the logo). Invalid values are rejected with a 400.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Updated effective branding settings.
   *       400:
   *         description: Invalid or unknown setting field.
   *       401:
   *         description: Not authenticated.
   *       403:
   *         description: Admin access required.
   *       500:
   *         description: Failed to save branding settings.
   */
  router.patch(
    "/branding",
    requireAdmin,
    async (req: Request, res: Response) => {
      const result = await buildBrandingWrites(req.body, res);
      if (result === null) return;

      try {
        const settings = createCurrentSettingsRepository();
        if (result.writes.length > 0) {
          await settings.setMany(result.writes);
        }
        for (const key of result.deletes) {
          await settings.delete(key);
        }
        const resolved = await resolveBrandingSettings(settings);
        res.json(resolved);
      } catch (err) {
        databaseLogger.error("Failed to save branding settings", err);
        res.status(500).json({ error: "Failed to save branding settings" });
      }
    },
  );
}
