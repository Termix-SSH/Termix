import type { Request, Response, Router } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { createCurrentSettingsRepository } from "../repositories/factory.js";
import { resolveBrandingSettings } from "./branding-settings.js";

export function registerBrandingRoutes(router: Router): void {
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
}
