import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The tables come from ctx.db.define, which the SDK hands back untyped, and
// the drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface BookmarkTables {
  table: Table;
  pinnedTable: Table;
  shortcutsTable: Table;
  transferRecentTable: Table;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Recent/pinned/shortcut files and recent transfer destinations, adopted from
 * core's host.ts and host-file-manager-bookmark-routes.ts. Kept simple, direct
 * Drizzle calls rather than a repository layer, since each is a handful of
 * lines and nothing else in the plugin reuses them.
 */
export function registerBookmarkRoutes(
  app: Express,
  ctx: PluginContext,
  tables: BookmarkTables,
): void {
  const { table, pinnedTable, shortcutsTable, transferRecentTable } = tables;
  const client = () => ctx.db.client<Drizzle>();

  /**
   * @openapi
   * /plugin-api/file-manager/recent:
   *   get:
   *     summary: Get recent files
   *     description: Retrieves a list of recent files for a specific host.
   *     tags:
   *       - File Manager
   *     parameters:
   *       - in: query
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: A list of recent files.
   *       400:
   *         description: Invalid userId or hostId.
   *       500:
   *         description: Failed to fetch recent files.
   */
  app.get("/recent", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const hostIdQuery = Array.isArray(req.query.hostId)
      ? req.query.hostId[0]
      : req.query.hostId;
    const hostId = hostIdQuery ? parseInt(hostIdQuery as string) : null;

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (!hostId) {
      return res.status(400).json({ error: "Host ID is required" });
    }

    try {
      const drizzle = await client();
      const rows = await drizzle
        .select()
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.hostId, hostId)))
        .orderBy(desc(table.lastOpened))
        .limit(20);
      res.json(rows);
    } catch (err) {
      ctx.log.error("Failed to fetch recent files", err as Error);
      res.status(500).json({ error: "Failed to fetch recent files" });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/recent:
   *   post:
   *     summary: Add recent file
   *     description: Adds a file to the list of recent files for a host.
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: Recent file added.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to add recent file.
   */
  app.post("/recent", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const { hostId, path, name } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const drizzle = await client();
      const existing = await drizzle
        .select()
        .from(table)
        .where(
          and(
            eq(table.userId, userId),
            eq(table.hostId, hostId),
            eq(table.path, path),
          ),
        )
        .limit(1);

      const now = new Date().toISOString();
      if (existing[0]) {
        await drizzle
          .update(table)
          .set({ name: name ?? existing[0].name, lastOpened: now })
          .where(eq(table.id, existing[0].id));
      } else {
        await drizzle.insert(table).values({
          userId,
          hostId,
          path,
          name: name ?? path,
          lastOpened: now,
        });
      }
      await ctx.db.persist();
      res.json({ message: "Recent file added" });
    } catch (err) {
      ctx.log.error("Failed to add recent file", err as Error);
      res.status(500).json({ error: "Failed to add recent file" });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/recent:
   *   delete:
   *     summary: Remove recent file
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: Recent file removed.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to remove recent file.
   */
  app.delete("/recent", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const { hostId, path } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const drizzle = await client();
      await drizzle
        .delete(table)
        .where(
          and(
            eq(table.userId, userId),
            eq(table.hostId, hostId),
            eq(table.path, path),
          ),
        );
      await ctx.db.persist();
      res.json({ message: "Recent file removed" });
    } catch (err) {
      ctx.log.error("Failed to remove recent file", err as Error);
      res.status(500).json({ error: "Failed to remove recent file" });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/pinned:
   *   get:
   *     summary: Get pinned files
   *     tags:
   *       - File Manager
   *     parameters:
   *       - in: query
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: A list of pinned files.
   *       400:
   *         description: Invalid userId or hostId.
   *       500:
   *         description: Failed to fetch pinned files.
   */
  app.get("/pinned", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const hostIdQuery = Array.isArray(req.query.hostId)
      ? req.query.hostId[0]
      : req.query.hostId;
    const hostId = hostIdQuery ? parseInt(hostIdQuery as string) : null;

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (!hostId) {
      return res.status(400).json({ error: "Host ID is required" });
    }

    try {
      const drizzle = await client();
      const rows = await drizzle
        .select()
        .from(pinnedTable)
        .where(
          and(eq(pinnedTable.userId, userId), eq(pinnedTable.hostId, hostId)),
        )
        .orderBy(desc(pinnedTable.pinnedAt));
      res.json(rows);
    } catch (err) {
      ctx.log.error("Failed to fetch pinned files", err as Error);
      res.status(500).json({ error: "Failed to fetch pinned files" });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/pinned:
   *   post:
   *     summary: Add pinned file
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: File pinned.
   *       400:
   *         description: Invalid data.
   *       409:
   *         description: File already pinned.
   *       500:
   *         description: Failed to pin file.
   */
  app.post("/pinned", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const { hostId, path, name } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const drizzle = await client();
      const existing = await drizzle
        .select()
        .from(pinnedTable)
        .where(
          and(
            eq(pinnedTable.userId, userId),
            eq(pinnedTable.hostId, hostId),
            eq(pinnedTable.path, path),
          ),
        )
        .limit(1);

      if (existing[0]) {
        return res.status(409).json({ error: "File already pinned" });
      }

      await drizzle.insert(pinnedTable).values({
        userId,
        hostId,
        path,
        name: name ?? path,
        pinnedAt: new Date().toISOString(),
      });
      await ctx.db.persist();
      res.json({ message: "File pinned" });
    } catch (err) {
      ctx.log.error("Failed to pin file", err as Error);
      res.status(500).json({ error: "Failed to pin file" });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/pinned:
   *   delete:
   *     summary: Remove pinned file
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: Pinned file removed.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to remove pinned file.
   */
  app.delete("/pinned", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const { hostId, path } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const drizzle = await client();
      await drizzle
        .delete(pinnedTable)
        .where(
          and(
            eq(pinnedTable.userId, userId),
            eq(pinnedTable.hostId, hostId),
            eq(pinnedTable.path, path),
          ),
        );
      await ctx.db.persist();
      res.json({ message: "Pinned file removed" });
    } catch (err) {
      ctx.log.error("Failed to remove pinned file", err as Error);
      res.status(500).json({ error: "Failed to remove pinned file" });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/shortcuts:
   *   get:
   *     summary: Get shortcuts
   *     tags:
   *       - File Manager
   *     parameters:
   *       - in: query
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: A list of shortcuts.
   *       400:
   *         description: Invalid userId or hostId.
   *       500:
   *         description: Failed to fetch shortcuts.
   */
  app.get("/shortcuts", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const hostIdQuery = Array.isArray(req.query.hostId)
      ? req.query.hostId[0]
      : req.query.hostId;
    const hostId = hostIdQuery ? parseInt(hostIdQuery as string) : null;

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (!hostId) {
      return res.status(400).json({ error: "Host ID is required" });
    }

    try {
      const drizzle = await client();
      const rows = await drizzle
        .select()
        .from(shortcutsTable)
        .where(
          and(
            eq(shortcutsTable.userId, userId),
            eq(shortcutsTable.hostId, hostId),
          ),
        )
        .orderBy(desc(shortcutsTable.createdAt));
      res.json(rows);
    } catch (err) {
      ctx.log.error("Failed to fetch shortcuts", err as Error);
      res.status(500).json({ error: "Failed to fetch shortcuts" });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/shortcuts:
   *   post:
   *     summary: Add shortcut
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: Shortcut added.
   *       400:
   *         description: Invalid data.
   *       409:
   *         description: Shortcut already exists.
   *       500:
   *         description: Failed to add shortcut.
   */
  app.post("/shortcuts", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const { hostId, path, name } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const drizzle = await client();
      const existing = await drizzle
        .select()
        .from(shortcutsTable)
        .where(
          and(
            eq(shortcutsTable.userId, userId),
            eq(shortcutsTable.hostId, hostId),
            eq(shortcutsTable.path, path),
          ),
        )
        .limit(1);

      if (existing[0]) {
        return res.status(409).json({ error: "Shortcut already exists" });
      }

      await drizzle.insert(shortcutsTable).values({
        userId,
        hostId,
        path,
        name: name ?? path,
        createdAt: new Date().toISOString(),
      });
      await ctx.db.persist();
      res.json({ message: "Shortcut added" });
    } catch (err) {
      ctx.log.error("Failed to add shortcut", err as Error);
      res.status(500).json({ error: "Failed to add shortcut" });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/shortcuts:
   *   delete:
   *     summary: Remove shortcut
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: Shortcut removed.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to remove shortcut.
   */
  app.delete("/shortcuts", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const { hostId, path } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const drizzle = await client();
      await drizzle
        .delete(shortcutsTable)
        .where(
          and(
            eq(shortcutsTable.userId, userId),
            eq(shortcutsTable.hostId, hostId),
            eq(shortcutsTable.path, path),
          ),
        );
      await ctx.db.persist();
      res.json({ message: "Shortcut removed" });
    } catch (err) {
      ctx.log.error("Failed to remove shortcut", err as Error);
      res.status(500).json({ error: "Failed to remove shortcut" });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/transfer-recent:
   *   get:
   *     summary: Get recent transfer destinations
   *     description: Retrieves recently used host-to-host transfer destinations for a source host.
   *     tags:
   *       - File Manager
   *     parameters:
   *       - in: query
   *         name: sourceHostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: A list of recent transfer destinations.
   *       400:
   *         description: Invalid userId or sourceHostId.
   *       500:
   *         description: Failed to fetch recent destinations.
   */
  app.get("/transfer-recent", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const sourceHostIdQuery = Array.isArray(req.query.sourceHostId)
      ? req.query.sourceHostId[0]
      : req.query.sourceHostId;
    const sourceHostId = sourceHostIdQuery
      ? parseInt(sourceHostIdQuery as string)
      : null;

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (!sourceHostId) {
      return res.status(400).json({ error: "Source host ID is required" });
    }

    try {
      const drizzle = await client();
      const rows = await drizzle
        .select()
        .from(transferRecentTable)
        .where(
          and(
            eq(transferRecentTable.userId, userId),
            eq(transferRecentTable.sourceHostId, sourceHostId),
          ),
        )
        .orderBy(desc(transferRecentTable.lastUsed))
        .limit(10);
      res.json(rows);
    } catch (err) {
      ctx.log.error(
        "Failed to fetch transfer recent destinations",
        err as Error,
      );
      res.status(500).json({ error: "Failed to fetch recent destinations" });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/transfer-recent:
   *   post:
   *     summary: Save a recent transfer destination
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: Recent destination saved.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to save recent destination.
   */
  app.post("/transfer-recent", async (req: Request, res: Response) => {
    const userId = ctx.currentActor();
    const { sourceHostId, destHostId, destPath, destPathLabel } = req.body;

    if (
      !isNonEmptyString(userId) ||
      !sourceHostId ||
      !destHostId ||
      !destPath
    ) {
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const drizzle = await client();
      const existing = await drizzle
        .select()
        .from(transferRecentTable)
        .where(
          and(
            eq(transferRecentTable.userId, userId),
            eq(transferRecentTable.sourceHostId, sourceHostId),
            eq(transferRecentTable.destHostId, destHostId),
            eq(transferRecentTable.destPath, destPath),
          ),
        )
        .limit(1);

      const now = new Date().toISOString();
      if (existing[0]) {
        await drizzle
          .update(transferRecentTable)
          .set({
            destPathLabel: destPathLabel ?? existing[0].destPathLabel,
            lastUsed: now,
          })
          .where(eq(transferRecentTable.id, existing[0].id));
      } else {
        await drizzle.insert(transferRecentTable).values({
          userId,
          sourceHostId,
          destHostId,
          destPath,
          destPathLabel: destPathLabel ?? destPath,
          lastUsed: now,
        });
      }

      // Keep only the 10 most recent destinations per source host.
      const all = await drizzle
        .select()
        .from(transferRecentTable)
        .where(
          and(
            eq(transferRecentTable.userId, userId),
            eq(transferRecentTable.sourceHostId, sourceHostId),
          ),
        )
        .orderBy(desc(transferRecentTable.lastUsed));
      const stale = all.slice(10);
      for (const row of stale) {
        await drizzle
          .delete(transferRecentTable)
          .where(eq(transferRecentTable.id, row.id));
      }

      await ctx.db.persist();
      res.json({ message: "Recent destination saved" });
    } catch (err) {
      ctx.log.error("Failed to save transfer recent destination", err as Error);
      res.status(500).json({ error: "Failed to save recent destination" });
    }
  });
}
