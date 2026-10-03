import type { RequestHandler, Router } from "express";
import { createCurrentSettingsRepository } from "../repositories/factory.js";

const CATALOG_KEY = "host_tag_catalog";

export function registerHostTagRoutes(
  router: Router,
  authenticate: RequestHandler,
  requireAdmin: RequestHandler,
): void {
  router.get("/tags", authenticate, async (_req, res) => {
    const value = await createCurrentSettingsRepository().get(CATALOG_KEY);
    res.json({ tags: value ? JSON.parse(value) : [] });
  });

  router.put("/tags", authenticate, requireAdmin, async (req, res) => {
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
    await createCurrentSettingsRepository().set(
      CATALOG_KEY,
      JSON.stringify(normalized),
    );
    res.json({ tags: normalized });
  });
}
