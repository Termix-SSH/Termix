import type { Request, RequestHandler, Response, Router } from "express";
import { createCurrentSettingsRepository } from "../repositories/factory.js";
import { databaseLogger } from "../../utils/logger.js";

const CATALOG_KEY = "host_tag_catalog";

function parseCatalog(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

export function registerHostTagRoutes(
  router: Router,
  authenticate: RequestHandler,
  requireAdmin: RequestHandler,
): void {
  /**
   * @openapi
   * /host/tags:
   *   get:
   *     summary: Get the predefined host tags
   *     description: The instance-wide tag list host editors suggest. Any signed-in user can read it.
   *     tags:
   *       - SSH
   *     responses:
   *       200:
   *         description: The predefined tags.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tags:
   *                   type: array
   *                   items:
   *                     type: string
   *       500:
   *         description: Failed to read the tags.
   */
  router.get("/tags", authenticate, async (_req: Request, res: Response) => {
    try {
      const value = await createCurrentSettingsRepository().get(CATALOG_KEY);
      res.json({ tags: parseCatalog(value) });
    } catch (error) {
      databaseLogger.error("Failed to read host tags", error);
      res.status(500).json({ error: "Failed to read host tags" });
    }
  });

  /**
   * @openapi
   * /host/tags:
   *   put:
   *     summary: Replace the predefined host tags
   *     description: Sets the instance-wide tag list. Tags are trimmed and duplicates dropped. Tags already on hosts are not changed. Requires admin.settings.manage.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               tags:
   *                 type: array
   *                 maxItems: 500
   *                 items:
   *                   type: string
   *                   maxLength: 100
   *     responses:
   *       200:
   *         description: The saved tags.
   *       400:
   *         description: Not an array of up to 500 non-empty tags of at most 100 characters.
   *       403:
   *         description: Missing admin.settings.manage.
   *       500:
   *         description: Failed to save the tags.
   */
  router.put(
    "/tags",
    authenticate,
    requireAdmin,
    async (req: Request, res: Response) => {
      const tags: unknown = req.body?.tags;
      if (
        !Array.isArray(tags) ||
        tags.length > 500 ||
        tags.some(
          (tag) =>
            typeof tag !== "string" || !tag.trim() || tag.trim().length > 100,
        )
      ) {
        res.status(400).json({
          error: "Expected up to 500 non-empty tags of at most 100 characters",
        });
        return;
      }
      const normalized = [
        ...new Set((tags as string[]).map((tag) => tag.trim())),
      ];
      try {
        await createCurrentSettingsRepository().set(
          CATALOG_KEY,
          JSON.stringify(normalized),
        );
        res.json({ tags: normalized });
      } catch (error) {
        databaseLogger.error("Failed to save host tags", error);
        res.status(500).json({ error: "Failed to save host tags" });
      }
    },
  );
}
