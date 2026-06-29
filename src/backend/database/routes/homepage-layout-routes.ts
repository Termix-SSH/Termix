import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { homepageLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { homepageLayouts } from "../db/schema.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import express from "express";

export const homepageLayoutRouter = express.Router();

/**
 * @openapi
 * /homepage/layout:
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
homepageLayoutRouter.get("/", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rows = await db
      .select()
      .from(homepageLayouts)
      .where(eq(homepageLayouts.userId, userId));

    if (rows.length === 0) {
      return res.json(null);
    }

    const row = rows[0];
    const parsed = JSON.parse(row.layout || "{}");
    res.json({ ...row, layout: parsed });
  } catch (err) {
    homepageLogger.error("Failed to fetch homepage layout", err);
    res.status(500).json({ error: "Failed to fetch homepage layout" });
  }
});

/**
 * @openapi
 * /homepage/layout:
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
homepageLayoutRouter.put("/", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const layoutData = req.body;

  try {
    const existing = await db
      .select({ id: homepageLayouts.id })
      .from(homepageLayouts)
      .where(eq(homepageLayouts.userId, userId));

    const layoutJson = JSON.stringify(layoutData);
    const now = new Date().toISOString();

    if (existing.length === 0) {
      const [created] = await db
        .insert(homepageLayouts)
        .values({ userId, layout: layoutJson, updatedAt: now })
        .returning();
      const parsed = JSON.parse(created.layout);
      DatabaseSaveTrigger.triggerSave("homepage_layout_saved");
      return res.json({ ...created, layout: parsed });
    }

    const [updated] = await db
      .update(homepageLayouts)
      .set({ layout: layoutJson, updatedAt: now })
      .where(eq(homepageLayouts.userId, userId))
      .returning();

    const parsed = JSON.parse(updated.layout);
    DatabaseSaveTrigger.triggerSave("homepage_layout_saved");
    res.json({ ...updated, layout: parsed });
  } catch (err) {
    homepageLogger.error("Failed to save homepage layout", err);
    res.status(500).json({ error: "Failed to save homepage layout" });
  }
});
