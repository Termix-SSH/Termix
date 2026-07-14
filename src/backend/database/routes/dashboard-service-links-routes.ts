import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, Response } from "express";
import { dashboardLogger } from "../../utils/logger.js";
import { isNonEmptyString } from "./host-normalizers.js";
import express from "express";
import { createCurrentDashboardServiceLinkRepository } from "../repositories/current-dashboard-service-link-repository.js";

export const dashboardServiceLinksRouter = express.Router();

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @openapi
 * /service-links:
 *   get:
 *     summary: Get service links
 *     description: Returns all dashboard service links for the authenticated user.
 *     tags:
 *       - Dashboard
 *     responses:
 *       200:
 *         description: List of service links.
 *       500:
 *         description: Failed to fetch service links.
 */
dashboardServiceLinksRouter.get("/", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const links =
      await createCurrentDashboardServiceLinkRepository().listByUserId(userId);
    res.json(links);
  } catch (err) {
    dashboardLogger.error("Failed to fetch service links", err);
    res.status(500).json({ error: "Failed to fetch service links" });
  }
});

/**
 * @openapi
 * /service-links:
 *   post:
 *     summary: Create service link
 *     description: Creates a new dashboard service link for the authenticated user.
 *     tags:
 *       - Dashboard
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
dashboardServiceLinksRouter.post("/", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { label, url } = req.body;

  if (!isNonEmptyString(label) || !isNonEmptyString(url)) {
    return res.status(400).json({ error: "label and url are required" });
  }
  if (!isValidUrl(url)) {
    return res
      .status(400)
      .json({ error: "url must be a valid http or https URL" });
  }

  try {
    const created =
      await createCurrentDashboardServiceLinkRepository().createForUser(
        userId,
        {
          label: label.trim(),
          url: url.trim(),
        },
      );

    DatabaseSaveTrigger.triggerSave("dashboard_service_link_created");
    res.status(201).json(created);
  } catch (err) {
    dashboardLogger.error("Failed to create service link", err);
    res.status(500).json({ error: "Failed to create service link" });
  }
});

/**
 * @openapi
 * /service-links/{id}:
 *   delete:
 *     summary: Delete service link
 *     description: Deletes a dashboard service link by ID.
 *     tags:
 *       - Dashboard
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
dashboardServiceLinksRouter.delete(
  "/:id",
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const idParam = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    try {
      const existing =
        await createCurrentDashboardServiceLinkRepository().findByIdForUser(
          userId,
          id,
        );

      if (!existing) {
        return res.status(404).json({ error: "Not found" });
      }

      await createCurrentDashboardServiceLinkRepository().deleteForUser(
        userId,
        id,
      );

      DatabaseSaveTrigger.triggerSave("dashboard_service_link_deleted");
      res.json({ message: "Service link deleted" });
    } catch (err) {
      dashboardLogger.error("Failed to delete service link", err);
      res.status(500).json({ error: "Failed to delete service link" });
    }
  },
);

/**
 * @openapi
 * /service-links/{id}:
 *   put:
 *     summary: Update service link
 *     description: Updates label or url of a dashboard service link.
 *     tags:
 *       - Dashboard
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
dashboardServiceLinksRouter.put("/:id", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const idParam = Array.isArray(req.params.id)
    ? req.params.id[0]
    : req.params.id;
  const id = parseInt(idParam);
  const { label, url } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  if (url !== undefined && !isValidUrl(url)) {
    return res
      .status(400)
      .json({ error: "url must be a valid http or https URL" });
  }

  try {
    const existing =
      await createCurrentDashboardServiceLinkRepository().findByIdForUser(
        userId,
        id,
      );

    if (!existing) {
      return res.status(404).json({ error: "Not found" });
    }

    const updates: Partial<{ label: string; url: string }> = {};
    if (isNonEmptyString(label)) updates.label = label.trim();
    if (isNonEmptyString(url)) updates.url = url.trim();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const updated =
      await createCurrentDashboardServiceLinkRepository().updateForUser(
        userId,
        id,
        updates,
      );

    DatabaseSaveTrigger.triggerSave("dashboard_service_link_updated");
    res.json(updated);
  } catch (err) {
    dashboardLogger.error("Failed to update service link", err);
    res.status(500).json({ error: "Failed to update service link" });
  }
});
