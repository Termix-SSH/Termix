import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, RequestHandler, Response, Router } from "express";
import { sshLogger } from "../../utils/logger.js";
import { createCurrentFileManagerBookmarkRepository } from "../repositories/current-file-manager-bookmark-repository.js";
import { isNonEmptyString } from "./host-normalizers.js";

export function registerHostFileManagerBookmarkRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /host/file_manager/recent:
   *   get:
   *     summary: Get recent files
   *     description: Retrieves a list of recent files for a specific host.
   *     tags:
   *       - SSH
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
  router.get(
    "/file_manager/recent",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const hostIdQuery = Array.isArray(req.query.hostId)
        ? req.query.hostId[0]
        : req.query.hostId;
      const hostId = hostIdQuery ? parseInt(hostIdQuery as string) : null;

      if (!isNonEmptyString(userId)) {
        sshLogger.warn("Invalid userId for recent files fetch");
        return res.status(400).json({ error: "Invalid userId" });
      }

      if (!hostId) {
        sshLogger.warn("Host ID is required for recent files fetch");
        return res.status(400).json({ error: "Host ID is required" });
      }

      try {
        const recentFiles =
          await createCurrentFileManagerBookmarkRepository().listRecentForHost(
            userId,
            hostId,
            20,
          );

        res.json(recentFiles);
      } catch (err) {
        sshLogger.error("Failed to fetch recent files", err);
        res.status(500).json({ error: "Failed to fetch recent files" });
      }
    },
  );

  /**
   * @openapi
   * /host/file_manager/recent:
   *   post:
   *     summary: Add recent file
   *     description: Adds a file to the list of recent files for a host.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *               path:
   *                 type: string
   *               name:
   *                 type: string
   *     responses:
   *       200:
   *         description: Recent file added.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to add recent file.
   */
  router.post(
    "/file_manager/recent",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hostId, path, name } = req.body;

      if (!isNonEmptyString(userId) || !hostId || !path) {
        sshLogger.warn("Invalid data for recent file addition");
        return res.status(400).json({ error: "Invalid data" });
      }

      try {
        await createCurrentFileManagerBookmarkRepository().upsertRecent(
          userId,
          {
            hostId,
            path,
            name,
          },
        );

        res.json({ message: "Recent file added" });
      } catch (err) {
        sshLogger.error("Failed to add recent file", err);
        res.status(500).json({ error: "Failed to add recent file" });
      }
    },
  );

  /**
   * @openapi
   * /host/file_manager/recent:
   *   delete:
   *     summary: Remove recent file
   *     description: Removes a file from the list of recent files for a host.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *               path:
   *                 type: string
   *     responses:
   *       200:
   *         description: Recent file removed.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to remove recent file.
   */
  router.delete(
    "/file_manager/recent",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hostId, path } = req.body;

      if (!isNonEmptyString(userId) || !hostId || !path) {
        sshLogger.warn("Invalid data for recent file deletion");
        return res.status(400).json({ error: "Invalid data" });
      }

      try {
        await createCurrentFileManagerBookmarkRepository().deleteRecentForHostPath(
          userId,
          { hostId, path },
        );

        res.json({ message: "Recent file removed" });
      } catch (err) {
        sshLogger.error("Failed to remove recent file", err);
        res.status(500).json({ error: "Failed to remove recent file" });
      }
    },
  );

  /**
   * @openapi
   * /host/file_manager/pinned:
   *   get:
   *     summary: Get pinned files
   *     description: Retrieves a list of pinned files for a specific host.
   *     tags:
   *       - SSH
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
  router.get(
    "/file_manager/pinned",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const hostIdQuery = Array.isArray(req.query.hostId)
        ? req.query.hostId[0]
        : req.query.hostId;
      const hostId = hostIdQuery ? parseInt(hostIdQuery as string) : null;

      if (!isNonEmptyString(userId)) {
        sshLogger.warn("Invalid userId for pinned files fetch");
        return res.status(400).json({ error: "Invalid userId" });
      }

      if (!hostId) {
        sshLogger.warn("Host ID is required for pinned files fetch");
        return res.status(400).json({ error: "Host ID is required" });
      }

      try {
        const pinnedFiles =
          await createCurrentFileManagerBookmarkRepository().listPinnedForHost(
            userId,
            hostId,
          );

        res.json(pinnedFiles);
      } catch (err) {
        sshLogger.error("Failed to fetch pinned files", err);
        res.status(500).json({ error: "Failed to fetch pinned files" });
      }
    },
  );

  /**
   * @openapi
   * /host/file_manager/pinned:
   *   post:
   *     summary: Add pinned file
   *     description: Adds a file to the list of pinned files for a host.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *               path:
   *                 type: string
   *               name:
   *                 type: string
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
  router.post(
    "/file_manager/pinned",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hostId, path, name } = req.body;

      if (!isNonEmptyString(userId) || !hostId || !path) {
        sshLogger.warn("Invalid data for pinned file addition");
        return res.status(400).json({ error: "Invalid data" });
      }

      try {
        const created =
          await createCurrentFileManagerBookmarkRepository().createPinned(
            userId,
            { hostId, path, name },
          );

        if (!created) {
          return res.status(409).json({ error: "File already pinned" });
        }

        res.json({ message: "File pinned" });
      } catch (err) {
        sshLogger.error("Failed to pin file", err);
        res.status(500).json({ error: "Failed to pin file" });
      }
    },
  );

  /**
   * @openapi
   * /host/file_manager/pinned:
   *   delete:
   *     summary: Remove pinned file
   *     description: Removes a file from the list of pinned files for a host.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *               path:
   *                 type: string
   *     responses:
   *       200:
   *         description: Pinned file removed.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to remove pinned file.
   */
  router.delete(
    "/file_manager/pinned",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hostId, path } = req.body;

      if (!isNonEmptyString(userId) || !hostId || !path) {
        sshLogger.warn("Invalid data for pinned file deletion");
        return res.status(400).json({ error: "Invalid data" });
      }

      try {
        await createCurrentFileManagerBookmarkRepository().deletePinnedForHostPath(
          userId,
          { hostId, path },
        );

        res.json({ message: "Pinned file removed" });
      } catch (err) {
        sshLogger.error("Failed to remove pinned file", err);
        res.status(500).json({ error: "Failed to remove pinned file" });
      }
    },
  );

  /**
   * @openapi
   * /host/file_manager/shortcuts:
   *   get:
   *     summary: Get shortcuts
   *     description: Retrieves a list of shortcuts for a specific host.
   *     tags:
   *       - SSH
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
  router.get(
    "/file_manager/shortcuts",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const hostIdQuery = Array.isArray(req.query.hostId)
        ? req.query.hostId[0]
        : req.query.hostId;
      const hostId = hostIdQuery ? parseInt(hostIdQuery as string) : null;

      if (!isNonEmptyString(userId)) {
        sshLogger.warn("Invalid userId for shortcuts fetch");
        return res.status(400).json({ error: "Invalid userId" });
      }

      if (!hostId) {
        sshLogger.warn("Host ID is required for shortcuts fetch");
        return res.status(400).json({ error: "Host ID is required" });
      }

      try {
        const shortcuts =
          await createCurrentFileManagerBookmarkRepository().listShortcutsForHost(
            userId,
            hostId,
          );

        res.json(shortcuts);
      } catch (err) {
        sshLogger.error("Failed to fetch shortcuts", err);
        res.status(500).json({ error: "Failed to fetch shortcuts" });
      }
    },
  );

  /**
   * @openapi
   * /host/file_manager/shortcuts:
   *   post:
   *     summary: Add shortcut
   *     description: Adds a shortcut for a specific host.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *               path:
   *                 type: string
   *               name:
   *                 type: string
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
  router.post(
    "/file_manager/shortcuts",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hostId, path, name } = req.body;

      if (!isNonEmptyString(userId) || !hostId || !path) {
        sshLogger.warn("Invalid data for shortcut addition");
        return res.status(400).json({ error: "Invalid data" });
      }

      try {
        const created =
          await createCurrentFileManagerBookmarkRepository().createShortcut(
            userId,
            { hostId, path, name },
          );

        if (!created) {
          return res.status(409).json({ error: "Shortcut already exists" });
        }

        res.json({ message: "Shortcut added" });
      } catch (err) {
        sshLogger.error("Failed to add shortcut", err);
        res.status(500).json({ error: "Failed to add shortcut" });
      }
    },
  );

  /**
   * @openapi
   * /host/file_manager/shortcuts:
   *   delete:
   *     summary: Remove shortcut
   *     description: Removes a shortcut for a specific host.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *               path:
   *                 type: string
   *     responses:
   *       200:
   *         description: Shortcut removed.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to remove shortcut.
   */
  router.delete(
    "/file_manager/shortcuts",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hostId, path } = req.body;

      if (!isNonEmptyString(userId) || !hostId || !path) {
        sshLogger.warn("Invalid data for shortcut deletion");
        return res.status(400).json({ error: "Invalid data" });
      }

      try {
        await createCurrentFileManagerBookmarkRepository().deleteShortcutForHostPath(
          userId,
          { hostId, path },
        );

        res.json({ message: "Shortcut removed" });
      } catch (err) {
        sshLogger.error("Failed to remove shortcut", err);
        res.status(500).json({ error: "Failed to remove shortcut" });
      }
    },
  );
}
