import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { getErrorMessage, type TerminalLogger } from "./helpers.js";
import type { HistoryRepository } from "./history-repository.js";
import type { TerminalSessionManager } from "./session-manager.js";
import {
  ADMIN_KEYS,
  HOST_KEYS,
  readClientSettings,
  readImageStorageSettings,
} from "./settings.js";
import {
  createConcurrencyLimiter,
  exceedsNormalizedImageSize,
  imageExtensionForFormat,
} from "./images/image-utils.js";
import {
  selectImageStorageMode,
  probeLocalImageVisibility,
  storeImageLocally,
  storeImageViaSftp,
  TerminalImageStorageError,
  type ImageSftpClient,
} from "./images/image-storage.js";

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

export const SENSITIVE_COMMAND_PATTERNS = [
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

type SharpFactory = typeof import("sharp").default;

export interface TerminalRouteDeps {
  ctx: PluginContext;
  log: TerminalLogger;
  sessionManager: TerminalSessionManager;
  history: HistoryRepository;
}

/**
 * The terminal's HTTP routes, on a router core mounts at
 * /plugin-api/ssh-terminal/. It is created with rawBody so multer can read
 * the upload stream; JSON routes parse their own body.
 */
export function registerTerminalRoutes(
  router: Router,
  { ctx, log, sessionManager, history }: TerminalRouteDeps,
): void {
  const json = express.json({ limit: "2mb" });

  // Browser image handoff for local terminal-agent workflows.
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 50 * 1024 * 1024,
      fields: 4,
      fieldSize: 64 * 1024,
      files: 1,
      parts: 5,
      headerPairs: 200,
    },
  });
  const imageUploadMiddleware = imageUpload.single("image");

  let sharpFactory: SharpFactory | null = null;
  let sharpLoadFailure: string | null = null;

  // A static import of sharp takes the plugin down with it when the native
  // binary for the running architecture is missing. Resolve on first use so
  // only image upload is lost.
  async function loadSharp(): Promise<SharpFactory> {
    if (sharpFactory) return sharpFactory;
    if (sharpLoadFailure !== null) throw new Error(sharpLoadFailure);
    try {
      sharpFactory = (await import("sharp")).default;
      return sharpFactory;
    } catch (error) {
      sharpLoadFailure = getErrorMessage(error, "unknown");
      throw new Error(sharpLoadFailure);
    }
  }

  const imageProcessingLimiter = createConcurrencyLimiter(4, 4);
  const imageMultipartAdmissionLimiter = createConcurrencyLimiter(4, 4);
  let imageUploadSequence = 0;

  async function handleImageUploadMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    let releaseAdmission: (() => void) | undefined;
    try {
      releaseAdmission = await imageMultipartAdmissionLimiter.acquire();
    } catch {
      res.status(503).json({
        error: "Image upload capacity is temporarily unavailable",
        code: "IMAGE_UPLOAD_CAPACITY_EXCEEDED",
      });
      return;
    }

    imageUploadMiddleware(req, res, (error: unknown) => {
      try {
        if (!error) {
          next();
          return;
        }
        if (error instanceof multer.MulterError) {
          log.warn("Image upload multipart request rejected", {
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
        log.warn("Image upload multipart request malformed", {
          operation: "terminal_image_upload_multipart_invalid",
          contentType: req.headers["content-type"]?.split(";", 1)[0],
        });
        res.status(400).json({
          error: "Malformed image upload request",
          code: "IMAGE_MULTIPART_INVALID",
        });
      } finally {
        releaseAdmission?.();
      }
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

  /**
   * @openapi
   * /plugin-api/ssh-terminal/image-upload:
   *   post:
   *     summary: Upload an image into a terminal session
   *     description: Normalizes an uploaded or pasted image to PNG and stores it where the terminal's programs can read it, over SFTP on the connected host or in the backend's mapped local storage, depending on the image storage settings. Returns the path to hand to the program.
   *     tags:
   *       - Terminal
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               image:
   *                 type: string
   *                 format: binary
   *               instanceId:
   *                 type: string
   *               source:
   *                 type: string
   *                 enum: [file, clipboard]
   *               clientUploadTimestamp:
   *                 type: string
   *     responses:
   *       200:
   *         description: The stored image's path.
   *       400:
   *         description: Missing or invalid image or session.
   *       409:
   *         description: The terminal is not connected.
   *       413:
   *         description: The normalized image is too large.
   *       502:
   *         description: Writing to the remote host failed.
   *       503:
   *         description: Image storage or processing is unavailable.
   *       507:
   *         description: The image storage limit was reached.
   */
  router.post(
    "/image-upload",
    handleImageUploadMiddleware,
    async (req: Request, res: Response) => {
      const userId = ctx.currentActor();
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

      const requestId = randomUUID();
      const sequence = ++imageUploadSequence;
      const source =
        req.body?.source === "file" || req.body?.source === "clipboard"
          ? req.body.source
          : undefined;
      const clientUploadTimestamp =
        typeof req.body?.clientUploadTimestamp === "string" &&
        !Number.isNaN(Date.parse(req.body.clientUploadTimestamp))
          ? req.body.clientUploadTimestamp
          : undefined;
      const serverReceivedAt = new Date().toISOString();
      log.info("Terminal image upload received", {
        operation: "terminal_image_upload_received",
        requestId,
        sequence,
        source,
        clientUploadTimestamp,
        serverReceivedAt,
        bytes: req.file.size,
      });

      const storageSettings = await readImageStorageSettings(ctx);
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

      let sharp: SharpFactory;
      try {
        sharp = await loadSharp();
      } catch (error) {
        log.error("Image processing unavailable: sharp failed to load", error, {
          operation: "terminal_image_upload_sharp_unavailable",
          reason: getErrorMessage(error, "unknown"),
        });
        return res.status(503).json({
          error: "Image processing is unavailable on this installation",
          code: "IMAGE_PROCESSING_UNAVAILABLE",
        });
      }

      let normalizedImage: Buffer;
      let releaseImageProcessingSlot: (() => void) | undefined;
      try {
        releaseImageProcessingSlot = await imageProcessingLimiter.acquire();
      } catch {
        return res.status(503).json({
          error: "Image upload capacity is temporarily exhausted",
          code: "IMAGE_UPLOAD_CAPACITY_EXCEEDED",
        });
      }
      try {
        const image = sharp(req.file.buffer, {
          failOn: "error",
          limitInputPixels: 40_000_000,
        });
        const { format } = await image.metadata();
        if (!imageExtensionForFormat(format)) {
          return res.status(400).json({
            error: "Unsupported image format",
            code: "IMAGE_FORMAT_UNSUPPORTED",
          });
        }
        normalizedImage = await image.rotate().png().toBuffer();
        if (exceedsNormalizedImageSize(normalizedImage.length)) {
          return res.status(413).json({
            error: "Normalized image is too large",
            code: "IMAGE_NORMALIZED_SIZE_LIMIT",
          });
        }
      } catch (error) {
        log.warn("Image upload failed image decoding", {
          operation: "terminal_image_upload_decode",
          mimeType: req.file.mimetype,
          bytes: req.file.size,
          reason: getErrorMessage(error, "unknown"),
        });
        return res.status(400).json({
          error: "Invalid image data",
          code: "IMAGE_DECODE_FAILED",
        });
      } finally {
        releaseImageProcessingSlot?.();
      }

      let remoteSftp: ImageSftpClient | undefined;
      try {
        const stored =
          storageMode === "remote-sftp"
            ? await (async () => {
                remoteSftp = await new Promise<ImageSftpClient>(
                  (resolve, reject) => {
                    let settled = false;
                    const timer = setTimeout(() => {
                      settled = true;
                      reject(new Error("SFTP channel acquisition timed out"));
                    }, 3_000);
                    session!.sshConn!.sftp((err, sftp) => {
                      if (settled) {
                        sftp?.end?.();
                        return;
                      }
                      settled = true;
                      clearTimeout(timer);
                      if (err) return reject(err);
                      resolve(sftp);
                    });
                  },
                );
                return storeImageViaSftp(remoteSftp, normalizedImage, {
                  ttlMs: storageSettings.ttlMs,
                  maxCount: storageSettings.maxCount,
                  maxBytes: storageSettings.maxBytes,
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
                : error.code === "IMAGE_REMOTE_QUOTA_UNAVAILABLE"
                  ? 503
                  : error.code === "IMAGE_LOCAL_INSPECTION_FAILED"
                    ? 503
                    : 500;
          log.warn("Image upload storage write failed", {
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
        log.warn("Image upload failed to acquire remote channel", {
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
   * /plugin-api/ssh-terminal/image-storage/test:
   *   post:
   *     summary: Test image storage visibility (admin only)
   *     description: Reports which storage mode an upload would take for one of the caller's already-connected terminal sessions. Uses the bounded local-mapping probe only; it never opens new connections.
   *     tags:
   *       - Terminal
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               instanceId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Visibility test result.
   *       400:
   *         description: Missing terminal session instanceId.
   *       403:
   *         description: Admin access required.
   *       500:
   *         description: Failed to run the test.
   */
  router.post("/image-storage/test", json, async (req, res) => {
    if (!(await ctx.rbac.has("admin.plugins.manage"))) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const userId = ctx.currentActor() ?? "";
    const instanceId = req.body?.instanceId;
    if (typeof instanceId !== "string" || instanceId.trim().length === 0) {
      return res.status(400).json({
        error: "Missing terminal session",
        code: "IMAGE_SESSION_MISSING",
      });
    }

    try {
      const settings = await readImageStorageSettings(ctx);
      const session = findTerminalSession(userId, instanceId);
      const remoteSftpAvailable = !!session?.sshConn;

      let localHostVisible: boolean | null = null;
      if (settings.localMappingConfigured && session?.sshConn) {
        localHostVisible = await probeLocalImageVisibility(
          session.sshConn,
          settings,
        ).catch(() => false);
      }

      const selectedMode = selectImageStorageMode(settings, {
        remoteSftpAvailable,
        ...(localHostVisible !== null ? { localHostVisible } : {}),
      });

      res.json({
        mode: settings.mode,
        connected: !!session,
        remoteSftpAvailable,
        localHostVisible,
        selectedMode,
        localMappingConfigured: settings.localMappingConfigured,
      });
    } catch (err) {
      log.error("Failed to test image storage visibility", err);
      res
        .status(500)
        .json({ error: "Failed to test image storage visibility" });
    }
  });

  /**
   * @openapi
   * /plugin-api/ssh-terminal/client-settings:
   *   get:
   *     summary: Terminal settings every user's terminal needs
   *     description: The admin-set session timeout and persistence flag, whether command history is on, and the touch input tuning. Readable by any signed-in user; changing them goes through the plugin's admin settings.
   *     tags:
   *       - Terminal
   *     responses:
   *       200:
   *         description: The settings.
   *       500:
   *         description: Failed to load settings.
   */
  router.get("/client-settings", async (_req, res) => {
    try {
      res.json(await readClientSettings(ctx));
    } catch (err) {
      log.error("Failed to load terminal client settings", err);
      res.status(500).json({ error: "Failed to load settings" });
    }
  });

  /**
   * @openapi
   * /plugin-api/ssh-terminal/command-history:
   *   post:
   *     summary: Save command to history
   *     description: Saves a command to the caller's history for a host. Commands that look like they carry a secret, and anything while command history is off globally or for the host, are acknowledged but not stored.
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
   *         description: Command saved, or skipped on purpose.
   *       400:
   *         description: Missing required parameters.
   *       500:
   *         description: Failed to save command.
   */
  router.post("/command-history", json, async (req, res) => {
    const userId = ctx.currentActor();
    const { hostId, command } = req.body ?? {};

    if (!isNonEmptyString(userId) || !hostId || !isNonEmptyString(command)) {
      log.warn("Invalid command history save request", {
        operation: "command_history_save",
        userId,
        hasHostId: !!hostId,
        hasCommand: !!command,
      });
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const hostIdNum = parseInt(hostId, 10);
    const trimmedCommand = command.trim();
    const skipped = {
      id: 0,
      userId,
      hostId: hostIdNum,
      command: trimmedCommand,
      executedAt: new Date().toISOString(),
    };

    if (SENSITIVE_COMMAND_PATTERNS.some((p) => p.test(trimmedCommand))) {
      return res.status(201).json(skipped);
    }
    if ((await ctx.settings.get(ADMIN_KEYS.commandHistoryEnabled)) === false) {
      return res.status(201).json(skipped);
    }
    if (
      (await ctx.settings.getHost(
        hostIdNum,
        HOST_KEYS.enableCommandHistory,
      )) === false
    ) {
      return res.status(201).json(skipped);
    }

    try {
      const executedAt = new Date().toISOString();
      await history.create(userId, hostIdNum, trimmedCommand, executedAt);
      res.status(201).json({
        userId,
        hostId: hostIdNum,
        command: trimmedCommand,
        executedAt,
      });
    } catch (err) {
      log.error("Failed to save command to history", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to save command"),
      });
    }
  });

  /**
   * @openapi
   * /plugin-api/ssh-terminal/command-history/{hostId}:
   *   get:
   *     summary: Get command history
   *     description: The caller's distinct commands on a host, most recently used first, for autocomplete.
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
  router.get("/command-history/:hostId", async (req, res) => {
    const userId = ctx.currentActor();
    const hostIdNum = parseInt(String(req.params.hostId), 10);

    if (!isNonEmptyString(userId) || isNaN(hostIdNum)) {
      log.warn("Invalid command history fetch request", {
        userId,
        hostId: hostIdNum,
      });
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    try {
      res.json(await history.listUniqueCommandsForHost(userId, hostIdNum));
    } catch (err) {
      log.error("Failed to fetch command history", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to fetch history"),
      });
    }
  });

  /**
   * @openapi
   * /plugin-api/ssh-terminal/command-history/{hostId}/recent:
   *   get:
   *     summary: Get recent command history
   *     description: The caller's commands on a host, newest first, duplicates included. Needs hosts.view.
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
   *         description: Invalid host id.
   *       403:
   *         description: Missing the hosts.view permission.
   *       500:
   *         description: Failed to fetch command history.
   */
  router.get("/command-history/:hostId/recent", async (req, res) => {
    if (!(await ctx.rbac.has("hosts.view"))) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const userId = ctx.currentActor();
    const hostIdNum = parseInt(String(req.params.hostId), 10);
    if (!isNonEmptyString(userId) || !hostIdNum) {
      return res.status(400).json({ error: "Invalid userId or hostId" });
    }
    try {
      const rows = await history.listCommandsForHost(userId, hostIdNum);
      res.json(rows.map((row) => row.command));
    } catch (err) {
      log.error("Failed to fetch command history from database", err, {
        operation: "command_history_fetch",
        hostId: hostIdNum,
      });
      res.status(500).json({ error: "Failed to fetch command history" });
    }
  });

  /**
   * @openapi
   * /plugin-api/ssh-terminal/command-history/delete:
   *   post:
   *     summary: Delete a specific command from history
   *     description: Deletes one command from the caller's history for a host.
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
  router.post("/command-history/delete", json, async (req, res) => {
    const userId = ctx.currentActor();
    const { hostId, command } = req.body ?? {};

    if (!isNonEmptyString(userId) || !hostId || !isNonEmptyString(command)) {
      log.warn("Invalid command delete request", {
        operation: "command_history_delete",
        userId,
        hasHostId: !!hostId,
        hasCommand: !!command,
      });
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      await history.deleteCommandForHost(
        userId,
        parseInt(hostId, 10),
        command.trim(),
      );
      res.json({ success: true });
    } catch (err) {
      log.error("Failed to delete command from history", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to delete command"),
      });
    }
  });

  /**
   * @openapi
   * /plugin-api/ssh-terminal/command-history/{hostId}:
   *   delete:
   *     summary: Clear command history
   *     description: Clears the caller's whole command history for a host.
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
  router.delete("/command-history/:hostId", async (req, res) => {
    const userId = ctx.currentActor();
    const hostIdNum = parseInt(String(req.params.hostId), 10);

    if (!isNonEmptyString(userId) || isNaN(hostIdNum)) {
      log.warn("Invalid command history clear request");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      await history.deleteByUserAndHost(userId, hostIdNum);
      log.info("Terminal history cleared", {
        operation: "terminal_history_clear",
        userId,
        hostId: hostIdNum,
      });
      res.json({ success: true });
    } catch (err) {
      log.error("Failed to clear command history", err);
      res.status(500).json({
        error: getErrorMessage(err, "Failed to clear history"),
      });
    }
  });
}
