import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { homepageLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { homepageItems } from "../db/schema.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import express from "express";

export const homepageItemsRouter = express.Router();

/**
 * @openapi
 * /homepage/items:
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
homepageItemsRouter.get("/", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const items = await db
      .select()
      .from(homepageItems)
      .where(eq(homepageItems.userId, userId))
      .orderBy(asc(homepageItems.id));
    res.json(items);
  } catch (err) {
    homepageLogger.error("Failed to fetch homepage items", err);
    res.status(500).json({ error: "Failed to fetch homepage items" });
  }
});

/**
 * @openapi
 * /homepage/items:
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
homepageItemsRouter.post("/", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { typeId, title, config } = req.body;

  if (!typeId || typeof typeId !== "string") {
    return res.status(400).json({ error: "typeId is required" });
  }

  try {
    const [created] = await db
      .insert(homepageItems)
      .values({
        userId,
        typeId,
        title: title ?? null,
        config: config ? JSON.stringify(config) : "{}",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();
    DatabaseSaveTrigger.triggerSave("homepage_item_created");
    res.status(201).json(created);
  } catch (err) {
    homepageLogger.error("Failed to create homepage item", err);
    res.status(500).json({ error: "Failed to create homepage item" });
  }
});

/**
 * @openapi
 * /homepage/items/{id}:
 *   put:
 *     summary: Update homepage item
 *     description: Updates a homepage widget item.
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
 *         description: Invalid data.
 *       404:
 *         description: Not found.
 *       500:
 *         description: Failed to update homepage item.
 */
homepageItemsRouter.put("/:id", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { title, config } = req.body;

  try {
    const existing = await db
      .select()
      .from(homepageItems)
      .where(and(eq(homepageItems.id, id), eq(homepageItems.userId, userId)));

    if (existing.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    const updates: Partial<{
      title: string | null;
      config: string;
      updatedAt: string;
    }> = {
      updatedAt: new Date().toISOString(),
    };
    if (title !== undefined) updates.title = title;
    if (config !== undefined) updates.config = JSON.stringify(config);

    const [updated] = await db
      .update(homepageItems)
      .set(updates)
      .where(and(eq(homepageItems.id, id), eq(homepageItems.userId, userId)))
      .returning();

    DatabaseSaveTrigger.triggerSave("homepage_item_updated");
    res.json(updated);
  } catch (err) {
    homepageLogger.error("Failed to update homepage item", err);
    res.status(500).json({ error: "Failed to update homepage item" });
  }
});

/**
 * @openapi
 * /homepage/items/{id}:
 *   delete:
 *     summary: Delete homepage item
 *     description: Deletes a homepage widget item and cascades deletion to children if a folder.
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
homepageItemsRouter.delete("/:id", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const existing = await db
      .select()
      .from(homepageItems)
      .where(and(eq(homepageItems.id, id), eq(homepageItems.userId, userId)));

    if (existing.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    await db
      .delete(homepageItems)
      .where(and(eq(homepageItems.id, id), eq(homepageItems.userId, userId)));

    DatabaseSaveTrigger.triggerSave("homepage_item_deleted");
    res.json({ message: "Homepage item deleted" });
  } catch (err) {
    homepageLogger.error("Failed to delete homepage item", err);
    res.status(500).json({ error: "Failed to delete homepage item" });
  }
});
