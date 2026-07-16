import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, Response } from "express";
import { homepageLogger } from "../../utils/logger.js";
import express from "express";
import { createCurrentHomepageLayoutRepository } from "../repositories/factory.js";

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
    const row =
      await createCurrentHomepageLayoutRepository().findByUserId(userId);

    if (!row) {
      return res.json(null);
    }

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
    const layoutJson = JSON.stringify(layoutData);
    const now = new Date().toISOString();
    const updated = await createCurrentHomepageLayoutRepository().upsertForUser(
      userId,
      layoutJson,
      now,
    );

    const parsed = JSON.parse(updated.layout);
    res.json({ ...updated, layout: parsed });
  } catch (err) {
    homepageLogger.error("Failed to save homepage layout", err);
    res.status(500).json({ error: "Failed to save homepage layout" });
  }
});
