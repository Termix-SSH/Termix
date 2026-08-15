import { getErrorMessage } from "../../utils/error-message.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import sharp from "sharp";
import {
  exceedsNormalizedImageSize,
  imageExtensionForFormat,
} from "./terminal-image-utils.js";
import { resolveTerminalImageStorageSettings } from "./terminal-image-storage-settings.js";
import {
  selectImageStorageMode,
  probeLocalImageVisibility,
  storeImageLocally,
  storeImageViaSftp,
  TerminalImageStorageError,
  type ImageSftpClient,
} from "./terminal-image-storage.js";
import { authLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { sessionManager } from "../../hosts/terminal/session-manager.js";
import {
  createCurrentCommandHistoryRepository,
  createCurrentHostResolutionRepository,
  createCurrentSettingsRepository,
} from "../repositories/factory.js";

const router = express.Router();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

// Browser image handoff for local terminal-agent workflows.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const imageUploadMiddleware = imageUpload.single("image");

function handleImageUploadMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  imageUploadMiddleware(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      databaseLogger.warn("Image upload multipart request rejected", {
        operation: "terminal_image_upload_multipart_rejected",
        code: error.code,
        field: error.field,
        contentType: req.headers["content-type"]?.split(";", 1)[0],
      });
      res.status(400).json({
        error: "Image upload request rejected",
        code: error.code,
        field: error.field,
      });
      return;
    }
    databaseLogger.warn("Image upload multipart request malformed", {
      operation: "terminal_image_upload_multipart_invalid",
      contentType: req.headers["content-type"]?.split(";", 1)[0],
    });
    res.status(400).json({
      error: "Malformed image upload request",
      code: "IMAGE_MULTIPART_INVALID",
    });
  });
}
function findTerminalSession(userId: string, instanceId: string) {
  return sessionManager
    .getUserSessions(userId)
    .find(
      (session) =>
        (session.attachedTabInstanceId ?? session.tabInstanceId) ===
          instanceId && session.isConnected,
    );
}

router.post(
  "/image-upload",
  authenticateJWT,
  requireDataAccess,
  handleImageUploadMiddleware,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const instanceId = req.body?.instanceId;
    if (!req.file) {
      return res.status(400).json({
        error: "Image required",
        code: "IMAGE_FILE_MISSING",
      });
    }
    if (!isNonEmptyString(userId)) {
      return res.status(400).json({
        error: "Missing terminal session",
        code: "IMAGE_SESSION_MISSING",
      });
    }

    const storageSettings = await resolveTerminalImageStorageSettings(
      createCurrentSettingsRepository(),
    );
    const session = isNonEmptyString(instanceId)
      ? findTerminalSession(userId, instanceId)
      : undefined;
    let localHostVisible = false;
    if (storageSettings.localMappingConfigured && session?.sshConn) {
      localHostVisible = await probeLocalImageVisibility(
        session.sshConn,
        storageSettings,
      ).catch(() => false);
    }
    const storageMode = selectImageStorageMode(storageSettings, {
      remoteSftpAvailable: !!session?.sshConn,
      localHostVisible,
    });

    if (storageMode === "unavailable") {
      return res.status(503).json({
        error: "Image storage is unavailable",
        code: "IMAGE_STORAGE_UNAVAILABLE",
      });
    }

    if (storageMode === "local" && !storageSettings.localMappingConfigured) {
      return res.status(503).json({
        error: "Local image storage is not configured",
        code: "IMAGE_LOCAL_STORAGE_NOT_CONFIGURED",
      });
    }

    if (storageMode === "remote-sftp") {
      if (!isNonEmptyString(instanceId)) {
        return res.status(400).json({
          error: "Missing terminal session",
          code: "IMAGE_SESSION_MISSING",
        });
      }
      if (!session || !session.sshConn) {
        return res.status(409).json({
          error: "Terminal is not connected",
          code: "IMAGE_TERMINAL_NOT_CONNECTED",
        });
      }
    }

    let normalizedImage: Buffer;
    try {
      const source = sharp(req.file.buffer, {
        failOn: "error",
        limitInputPixels: 40_000_000,
      });
      const { format } = await source.metadata();
      if (!imageExtensionForFormat(format)) {
        return res.status(400).json({
          error: "Unsupported image format",
          code: "IMAGE_FORMAT_UNSUPPORTED",
        });
      }
      normalizedImage = await source.rotate().png().toBuffer();
      if (exceedsNormalizedImageSize(normalizedImage.length)) {
        return res.status(413).json({
          error: "Normalized image is too large",
          code: "IMAGE_NORMALIZED_SIZE_LIMIT",
        });
      }
    } catch (error) {
      databaseLogger.warn("Image upload failed image decoding", {
        operation: "terminal_image_upload_decode",
        mimeType: req.file.mimetype,
        bytes: req.file.size,
        reason: getErrorMessage(error, "unknown"),
      });
      return res.status(400).json({
        error: "Invalid image data",
        code: "IMAGE_DECODE_FAILED",
      });
    }

    let remoteSftp: ImageSftpClient | undefined;
    try {
      const stored =
        storageMode === "remote-sftp"
          ? await (async () => {
              remoteSftp = await new Promise<ImageSftpClient>((resolve, reject) => {
                session!.sshConn!.sftp((err, sftp) => {
                  if (err) return reject(err);
                  resolve(sftp);
                });
              });
              return storeImageViaSftp(remoteSftp, normalizedImage, {
                ttlMs: storageSettings.ttlMs,
              });
            })()
          : await storeImageLocally(normalizedImage, storageSettings);

      res.json(stored);
    } catch (error) {
      if (error instanceof TerminalImageStorageError) {
        const status =
          error.code === "IMAGE_STORAGE_LIMIT_REACHED"
            ? 507
            : error.code === "IMAGE_REMOTE_WRITE_FAILED"
              ? 502
              : 500;
        databaseLogger.warn("Image upload storage write failed", {
          operation:
            error.code === "IMAGE_REMOTE_WRITE_FAILED"
              ? "terminal_image_upload_sftp_failed"
              : "terminal_image_upload_local_failed",
          code: error.code,
          userId,
          instanceId,
          reason: getErrorMessage(error.cause ?? error, "unknown"),
        });
        return res.status(status).json({
          error: error.message,
          code: error.code,
        });
      }
      databaseLogger.warn("Image upload failed to acquire remote channel", {
        operation: "terminal_image_upload_sftp_failed",
        code: "IMAGE_REMOTE_WRITE_FAILED",
        userId,
        instanceId,
        reason: getErrorMessage(error, "unknown"),
      });
      return res.status(502).json({
        error: "Failed to write image to the remote host",
        code: "IMAGE_REMOTE_WRITE_FAILED",
      });
    } finally {
      remoteSftp?.end?.();
    }
  },
);

/**
 * @openapi
 * /terminal/command_history:
 *   post:
 *     summary: Save command to history
 *     description: Saves a command to the command history for a specific host.
 *     tags:
 *       - Terminal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               command:
 *                 type: string
 *     responses:
 *       201:
 *         description: Command saved successfully.
 *       400:
 *         description: Missing required parameters.
 *       500:
 *         description: Failed to save command.
 */
router.post(
  "/command_history",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, command } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !isNonEmptyString(command)) {
      authLogger.warn("Invalid command history save request", {
        operation: "command_history_save",
        userId,
        hasHostId: !!hostId,
        hasCommand: !!command,
      });
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const sensitivePatterns = [
      /passw(or)?d/i,
      /\bsecret\b/i,
      /\btoken\b/i,
      /\bapi.?key\b/i,
      /PASS(WORD)?=/i,
      /AWS_SECRET/i,
      /mysql\b.*-p/i,
      /sudo\s+-S\b/,
      /htpasswd/i,
      /sshpass/i,
      /curl\b.*-u\s/i,
      /export\b.*(?:PASSWORD|SECRET|TOKEN|KEY)=/i,
    ];

    const trimmedCommand = command.trim();
    if (sensitivePatterns.some((p: RegExp) => p.test(trimmedCommand))) {
      return res.status(201).json({
        id: 0,
        userId,
        hostId: parseInt(hostId, 10),
        command: trimmedCommand,
        executedAt: new Date().toISOString(),
      });
    }

    const globalEnabled = await createCurrentSettingsRepository().getBoolean(
      "command_history_enabled",
      true,
    );
    if (!globalEnabled) {
      return res.status(201).json({
        id: 0,
        userId,
        hostId: parseInt(hostId, 10),
        command: trimmedCommand,
        executedAt: new Date().toISOString(),
      });
    }

    const hostRecord =
      await createCurrentHostResolutionRepository().findHostById(
        parseInt(hostId, 10),
        userId,
      );
    if (hostRecord?.enableCommandHistory === false) {
      return res.status(201).json({
        id: 0,
        userId,
        hostId: parseInt(hostId, 10),
        command: trimmedCommand,
        executedAt: new Date().toISOString(),
      });
    }

    try {
      const result = await createCurrentCommandHistoryRepository().create(
        userId,
        parseInt(hostId, 10),
        trimmedCommand,
      );

      res.status(201).json(result);
    } catch (err) {
      authLogger.error("Failed to save command to history", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to save command"),
      });
    }
  },
);

/**
 * @openapi
 * /terminal/command_history/{hostId}:
 *   get:
 *     summary: Get command history
 *     description: Retrieves the command history for a specific host.
 *     tags:
 *       - Terminal
 *     parameters:
 *       - in: path
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: A list of commands.
 *       400:
 *         description: Invalid request parameters.
 *       500:
 *         description: Failed to fetch history.
 */
router.get(
  "/command_history/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = Array.isArray(req.params.hostId)
      ? req.params.hostId[0]
      : req.params.hostId;
    const hostIdNum = parseInt(hostId, 10);

    if (!isNonEmptyString(userId) || isNaN(hostIdNum)) {
      authLogger.warn("Invalid command history fetch request", {
        userId,
        hostId: hostIdNum,
      });
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    try {
      const uniqueCommands =
        await createCurrentCommandHistoryRepository().listUniqueCommandsForHost(
          userId,
          hostIdNum,
        );

      res.json(uniqueCommands);
    } catch (err) {
      authLogger.error("Failed to fetch command history", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to fetch history"),
      });
    }
  },
);

/**
 * @openapi
 * /terminal/command_history/delete:
 *   post:
 *     summary: Delete a specific command from history
 *     description: Deletes a specific command from the history of a host.
 *     tags:
 *       - Terminal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               command:
 *                 type: string
 *     responses:
 *       200:
 *         description: Command deleted successfully.
 *       400:
 *         description: Missing required parameters.
 *       500:
 *         description: Failed to delete command.
 */
router.post(
  "/command_history/delete",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, command } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !isNonEmptyString(command)) {
      authLogger.warn("Invalid command delete request", {
        operation: "command_history_delete",
        userId,
        hasHostId: !!hostId,
        hasCommand: !!command,
      });
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const hostIdNum = parseInt(hostId, 10);

      await createCurrentCommandHistoryRepository().deleteCommandForHost(
        userId,
        hostIdNum,
        command.trim(),
      );

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete command from history", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to delete command"),
      });
    }
  },
);

/**
 * @openapi
 * /terminal/command_history/{hostId}:
 *   delete:
 *     summary: Clear command history
 *     description: Clears the entire command history for a specific host.
 *     tags:
 *       - Terminal
 *     parameters:
 *       - in: path
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Command history cleared successfully.
 *       400:
 *         description: Invalid request.
 *       500:
 *         description: Failed to clear history.
 */
router.delete(
  "/command_history/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = Array.isArray(req.params.hostId)
      ? req.params.hostId[0]
      : req.params.hostId;
    const hostIdNum = parseInt(hostId, 10);

    if (!isNonEmptyString(userId) || isNaN(hostIdNum)) {
      authLogger.warn("Invalid command history clear request");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      await createCurrentCommandHistoryRepository().deleteByUserAndHost(
        userId,
        hostIdNum,
      );
      databaseLogger.info("Terminal history cleared", {
        operation: "terminal_history_clear",
        userId,
        hostId: hostIdNum,
      });

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to clear command history", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to clear history"),
      });
    }
  },
);

/**
 * @openapi
 * /terminal/session_settings:
 *   get:
 *     summary: Get session persistence settings
 *     description: Returns the session timeout and persistence enabled flag.
 *     tags:
 *       - Terminal
 *     responses:
 *       200:
 *         description: Session settings.
 *       500:
 *         description: Failed to fetch settings.
 */
router.get(
  "/session_settings",
  authenticateJWT,
  async (_req: Request, res: Response) => {
    try {
      const settings = createCurrentSettingsRepository();
      const timeoutValue = await settings.get(
        "terminal_session_timeout_minutes",
      );
      const enabled = await settings.getBoolean(
        "terminal_session_persistence_enabled",
        true,
      );

      res.json({
        timeoutMinutes: timeoutValue ? parseInt(timeoutValue, 10) : 30,
        enabled,
      });
    } catch (err) {
      authLogger.error("Failed to fetch session settings", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to fetch settings"),
      });
    }
  },
);

/**
 * @openapi
 * /terminal/session_settings:
 *   post:
 *     summary: Update session persistence settings
 *     description: Saves session timeout and persistence enabled flag.
 *     tags:
 *       - Terminal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               timeoutMinutes:
 *                 type: integer
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Settings saved successfully.
 *       400:
 *         description: Invalid parameters.
 *       500:
 *         description: Failed to save settings.
 */
router.post(
  "/session_settings",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const { timeoutMinutes, enabled } = req.body;

    if (
      timeoutMinutes !== undefined &&
      (typeof timeoutMinutes !== "number" ||
        timeoutMinutes < 1 ||
        timeoutMinutes > 1440)
    ) {
      return res
        .status(400)
        .json({ error: "timeoutMinutes must be between 1 and 1440" });
    }

    try {
      const settings = createCurrentSettingsRepository();
      if (timeoutMinutes !== undefined) {
        await settings.set(
          "terminal_session_timeout_minutes",
          String(timeoutMinutes),
        );
      }

      if (enabled !== undefined) {
        await settings.set(
          "terminal_session_persistence_enabled",
          String(enabled),
        );
      }

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to save session settings", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to save settings"),
      });
    }
  },
);

export default router;
