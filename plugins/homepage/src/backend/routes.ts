import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { HomepageRepository } from "./repository.js";
import { isValidServiceLinkUrl, normalizeServiceLinkUrl } from "./url.js";

function actor(ctx: PluginContext): string {
  // Core's plugin router authenticates every request and runs it as that user.
  return ctx.currentActor() as string;
}

function parseId(raw: unknown): number | null {
  const id = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isInteger(id) ? id : null;
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function logError(
  ctx: PluginContext,
  message: string,
  error: unknown,
  operation: string,
): void {
  ctx.log.error(
    `${message} (${operation})`,
    error instanceof Error ? error : new Error(String(error)),
  );
}

/**
 * Mounts the homepage routes on the plugin's router, served at
 * /plugin-api/homepage with core auth in front.
 */
export function registerHomepageRoutes(
  router: Router,
  repo: HomepageRepository,
  ctx: PluginContext,
): void {
  router.use(ctx.rbac.require("use") as never);

  /**
   * @openapi
   * /plugin-api/homepage/items:
   *   get:
   *     summary: Get homepage items
   *     description: Returns all homepage widget items for the authenticated user.
   *     tags:
   *       - Homepage
   *     responses:
   *       200:
   *         description: List of homepage items.
   *       500:
   *         description: Failed to fetch homepage items.
   */
  router.get("/items", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    try {
      const items = await repo.listItemsByUser(userId);
      res.json(items);
    } catch (err) {
      logError(
        ctx,
        "Failed to fetch homepage items",
        err,
        "homepage_items_list_failed",
      );
      res.status(500).json({ error: "Failed to fetch homepage items" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/items:
   *   post:
   *     summary: Create homepage item
   *     description: Creates a new homepage widget item for the authenticated user.
   *     tags:
   *       - Homepage
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - typeId
   *             properties:
   *               typeId:
   *                 type: string
   *               title:
   *                 type: string
   *               config:
   *                 type: object
   *     responses:
   *       201:
   *         description: Homepage item created.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to create homepage item.
   */
  router.post("/items", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const { typeId, title, config } = req.body ?? {};

    if (!isNonEmptyString(typeId)) {
      return res.status(400).json({ error: "typeId is required" });
    }

    try {
      const created = await repo.createItem(userId, {
        typeId,
        title: title ?? null,
        config: config ? JSON.stringify(config) : "{}",
      });
      res.status(201).json(created);
    } catch (err) {
      logError(
        ctx,
        "Failed to create homepage item",
        err,
        "homepage_item_create_failed",
      );
      res.status(500).json({ error: "Failed to create homepage item" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/items/{id}:
   *   put:
   *     summary: Update homepage item
   *     description: Updates a homepage widget item's title or config.
   *     tags:
   *       - Homepage
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title:
   *                 type: string
   *               config:
   *                 type: object
   *     responses:
   *       200:
   *         description: Homepage item updated.
   *       400:
   *         description: Invalid id.
   *       404:
   *         description: Not found.
   *       500:
   *         description: Failed to update homepage item.
   */
  router.put("/items/:id", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    const { title, config } = req.body ?? {};
    const updates: { title?: string | null; config?: string } = {};
    if (title !== undefined) updates.title = title;
    if (config !== undefined) updates.config = JSON.stringify(config);

    try {
      const updated = await repo.updateItem(userId, id, updates);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      logError(
        ctx,
        "Failed to update homepage item",
        err,
        "homepage_item_update_failed",
      );
      res.status(500).json({ error: "Failed to update homepage item" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/items/{id}:
   *   delete:
   *     summary: Delete homepage item
   *     description: Deletes a homepage widget item.
   *     tags:
   *       - Homepage
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Homepage item deleted.
   *       400:
   *         description: Invalid id.
   *       404:
   *         description: Not found.
   *       500:
   *         description: Failed to delete homepage item.
   */
  router.delete("/items/:id", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    try {
      const deleted = await repo.deleteItem(userId, id);
      if (!deleted) return res.status(404).json({ error: "Not found" });
      await ctx.sync.recordTombstone(userId, "homepageItems", deleted.syncId);
      res.json({ message: "Homepage item deleted" });
    } catch (err) {
      logError(
        ctx,
        "Failed to delete homepage item",
        err,
        "homepage_item_delete_failed",
      );
      res.status(500).json({ error: "Failed to delete homepage item" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/layout:
   *   get:
   *     summary: Get homepage layout
   *     description: Returns the homepage canvas layout (widget positions, pan, zoom) for the authenticated user.
   *     tags:
   *       - Homepage
   *     responses:
   *       200:
   *         description: Layout data or null.
   *       500:
   *         description: Failed to fetch homepage layout.
   */
  router.get("/layout", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    try {
      const row = await repo.findLayoutByUser(userId);
      if (!row) return res.json(null);
      const parsed = JSON.parse(row.layout || "{}");
      res.json({ ...row, layout: parsed });
    } catch (err) {
      logError(
        ctx,
        "Failed to fetch homepage layout",
        err,
        "homepage_layout_get_failed",
      );
      res.status(500).json({ error: "Failed to fetch homepage layout" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/layout:
   *   put:
   *     summary: Save homepage layout
   *     description: Saves or updates the homepage canvas layout for the authenticated user.
   *     tags:
   *       - Homepage
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               entries:
   *                 type: array
   *               pan:
   *                 type: object
   *               zoom:
   *                 type: number
   *     responses:
   *       200:
   *         description: Layout saved.
   *       500:
   *         description: Failed to save homepage layout.
   */
  router.put("/layout", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    try {
      const layoutJson = JSON.stringify(req.body ?? {});
      const now = new Date().toISOString();
      const updated = await repo.upsertLayout(userId, layoutJson, now);
      const parsed = JSON.parse(updated.layout);
      res.json({ ...updated, layout: parsed });
    } catch (err) {
      logError(
        ctx,
        "Failed to save homepage layout",
        err,
        "homepage_layout_save_failed",
      );
      res.status(500).json({ error: "Failed to save homepage layout" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/service-links:
   *   get:
   *     summary: Get service links
   *     description: Returns all dashboard service links for the authenticated user.
   *     tags:
   *       - Homepage
   *     responses:
   *       200:
   *         description: List of service links.
   *       500:
   *         description: Failed to fetch service links.
   */
  router.get("/service-links", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    try {
      const links = await repo.listServiceLinksByUser(userId);
      res.json(links);
    } catch (err) {
      logError(
        ctx,
        "Failed to fetch service links",
        err,
        "service_links_list_failed",
      );
      res.status(500).json({ error: "Failed to fetch service links" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/service-links:
   *   post:
   *     summary: Create service link
   *     description: Creates a new dashboard service link for the authenticated user.
   *     tags:
   *       - Homepage
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - label
   *               - url
   *             properties:
   *               label:
   *                 type: string
   *               url:
   *                 type: string
   *     responses:
   *       201:
   *         description: Service link created.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to create service link.
   */
  router.post("/service-links", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const { label, url } = req.body ?? {};

    if (!isNonEmptyString(label) || !isNonEmptyString(url)) {
      return res.status(400).json({ error: "label and url are required" });
    }
    const normalizedUrl = normalizeServiceLinkUrl(url);
    if (!isValidServiceLinkUrl(normalizedUrl)) {
      return res
        .status(400)
        .json({ error: "url must be a valid http or https URL" });
    }

    try {
      const created = await repo.createServiceLink(userId, {
        label: label.trim(),
        url: normalizedUrl,
      });
      res.status(201).json(created);
    } catch (err) {
      logError(
        ctx,
        "Failed to create service link",
        err,
        "service_link_create_failed",
      );
      res.status(500).json({ error: "Failed to create service link" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/service-links/{id}:
   *   put:
   *     summary: Update service link
   *     description: Updates label or url of a dashboard service link.
   *     tags:
   *       - Homepage
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               label:
   *                 type: string
   *               url:
   *                 type: string
   *     responses:
   *       200:
   *         description: Service link updated.
   *       400:
   *         description: Invalid data.
   *       404:
   *         description: Not found.
   *       500:
   *         description: Failed to update service link.
   */
  router.put("/service-links/:id", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    const { label, url } = req.body ?? {};
    if (
      url !== undefined &&
      !isValidServiceLinkUrl(normalizeServiceLinkUrl(url))
    ) {
      return res
        .status(400)
        .json({ error: "url must be a valid http or https URL" });
    }

    const updates: { label?: string; url?: string } = {};
    if (isNonEmptyString(label)) updates.label = label.trim();
    if (isNonEmptyString(url)) updates.url = normalizeServiceLinkUrl(url);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    try {
      const updated = await repo.updateServiceLink(userId, id, updates);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      logError(
        ctx,
        "Failed to update service link",
        err,
        "service_link_update_failed",
      );
      res.status(500).json({ error: "Failed to update service link" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/service-links/{id}:
   *   delete:
   *     summary: Delete service link
   *     description: Deletes a dashboard service link by id.
   *     tags:
   *       - Homepage
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Service link deleted.
   *       400:
   *         description: Invalid id.
   *       404:
   *         description: Not found.
   *       500:
   *         description: Failed to delete service link.
   */
  router.delete("/service-links/:id", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    try {
      const deleted = await repo.deleteServiceLink(userId, id);
      if (!deleted) return res.status(404).json({ error: "Not found" });
      await ctx.sync.recordTombstone(
        userId,
        "dashboardServiceLinks",
        deleted.syncId,
      );
      res.json({ message: "Service link deleted" });
    } catch (err) {
      logError(
        ctx,
        "Failed to delete service link",
        err,
        "service_link_delete_failed",
      );
      res.status(500).json({ error: "Failed to delete service link" });
    }
  });
}
