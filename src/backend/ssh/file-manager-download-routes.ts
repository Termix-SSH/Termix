import type { Express } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { fileLogger } from "../utils/logger.js";
import { getMimeType } from "./file-manager-utils.js";
import { getSessionSftp, type SSHSession } from "./file-manager-session.js";

type FileDownloadRoutesDeps = {
  sshSessions: Record<string, SSHSession>;
  scheduleSessionCleanup: (sessionId: string) => void;
  verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
};

export function registerFileDownloadRoutes(
  app: Express,
  {
    sshSessions,
    scheduleSessionCleanup,
    verifySessionOwnership,
  }: FileDownloadRoutesDeps,
): void {
  /**
   * @openapi
   * /ssh/file_manager/ssh/downloadFile:
   *   post:
   *     summary: Download a file
   *     description: Downloads a file from the remote host.
   *     tags:
   *       - File Manager
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *               path:
   *                 type: string
   *               hostId:
   *                 type: integer
   *               userId:
   *                 type: string
   *     responses:
   *       200:
   *         description: The file content.
   *       400:
   *         description: Missing required parameters or file too large.
   *       500:
   *         description: Failed to download file.
   */
  app.post("/ssh/file_manager/ssh/downloadFile", async (req, res) => {
    const { sessionId, path: filePath, hostId } = req.body;
    const userId = (req as AuthenticatedRequest).userId;
    const downloadStartTime = Date.now();

    if (!sessionId || !filePath) {
      fileLogger.warn("Missing download parameters", {
        operation: "file_download",
        sessionId,
        hasFilePath: !!filePath,
      });
      return res.status(400).json({ error: "Missing download parameters" });
    }

    fileLogger.info("File download started", {
      operation: "file_download_start",
      sessionId,
      userId,
      path: filePath,
    });

    const sshConn = sshSessions[sessionId];
    if (!sshConn || !sshConn.isConnected) {
      fileLogger.warn("SSH session not found or not connected for download", {
        operation: "file_download",
        sessionId,
        isConnected: sshConn?.isConnected,
      });
      return res
        .status(400)
        .json({ error: "SSH session not found or not connected" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    sshConn.lastActive = Date.now();
    scheduleSessionCleanup(sessionId);
    fileLogger.info("Opening SFTP channel", {
      operation: "file_sftp_open",
      sessionId,
      userId,
      path: filePath,
    });

    getSessionSftp(sshConn)
      .then((sftp) => {
        sftp.stat(filePath, (statErr, stats) => {
          if (statErr) {
            fileLogger.error("File stat failed for download:", statErr);
            return res
              .status(500)
              .json({ error: `Cannot access file: ${statErr.message}` });
          }

          if (!stats.isFile()) {
            fileLogger.warn("Attempted to download non-file", {
              operation: "file_download",
              sessionId,
              filePath,
              isFile: stats.isFile(),
              isDirectory: stats.isDirectory(),
            });
            return res
              .status(400)
              .json({ error: "Cannot download directories or special files" });
          }

          const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;
          if (stats.size > MAX_FILE_SIZE) {
            fileLogger.warn("File too large for download", {
              operation: "file_download",
              sessionId,
              filePath,
              fileSize: stats.size,
              maxSize: MAX_FILE_SIZE,
            });
            return res.status(400).json({
              error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB, file is ${(stats.size / 1024 / 1024).toFixed(2)}MB`,
            });
          }

          sftp.readFile(filePath, (readErr, data) => {
            if (readErr) {
              fileLogger.error("File read failed for download:", readErr);
              return res
                .status(500)
                .json({ error: `Failed to read file: ${readErr.message}` });
            }

            const base64Content = data.toString("base64");
            const fileName = filePath.split("/").pop() || "download";
            fileLogger.success("File download completed", {
              operation: "file_download_complete",
              sessionId,
              userId,
              hostId,
              path: filePath,
              bytes: stats.size,
              duration: Date.now() - downloadStartTime,
            });

            res.json({
              content: base64Content,
              fileName: fileName,
              size: stats.size,
              mimeType: getMimeType(fileName),
              path: filePath,
            });
          });
        });
      })
      .catch((err) => {
        fileLogger.error("SFTP connection failed for download:", err);
        return res.status(500).json({ error: "SFTP connection failed" });
      });
  });

  app.post("/ssh/file_manager/ssh/downloadFileStream", async (req, res) => {
    const { sessionId, path: filePath } = req.body;
    const userId = (req as AuthenticatedRequest).userId;

    if (!sessionId || !filePath) {
      return res.status(400).json({ error: "Missing download parameters" });
    }

    const sshConn = sshSessions[sessionId];
    if (!sshConn?.isConnected) {
      return res
        .status(400)
        .json({ error: "SSH session not found or not connected" });
    }
    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    sshConn.lastActive = Date.now();

    try {
      const sftp = await getSessionSftp(sshConn);
      const stats = await new Promise<{ size: number; isFile: () => boolean }>(
        (resolve, reject) => {
          sftp.stat(filePath, (err, s) => (err ? reject(err) : resolve(s)));
        },
      );

      if (!stats.isFile()) {
        return res.status(400).json({ error: "Cannot download directories" });
      }

      const fileName = filePath.split("/").pop() || "download";
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(fileName)}"`,
      );
      res.setHeader("Content-Length", String(stats.size));

      const readStream = sftp.createReadStream(filePath);
      readStream.on("error", (err) => {
        if (!res.headersSent) {
          res.status(500).json({ error: `Download failed: ${err.message}` });
        } else {
          res.destroy();
        }
      });
      readStream.pipe(res);
    } catch (err) {
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: `Download failed: ${(err as Error).message}` });
      }
    }
  });
}
