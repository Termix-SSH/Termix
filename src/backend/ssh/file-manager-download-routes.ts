import type { Express } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { fileLogger } from "../utils/logger.js";
import { getMimeType } from "./file-manager-utils.js";
import {
  execChannel,
  getSessionSftp,
  type SSHSession,
} from "./file-manager-session.js";

type FileDownloadRoutesDeps = {
  sshSessions: Record<string, SSHSession>;
  scheduleSessionCleanup: (sessionId: string) => void;
  verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
};

function escapeSingleQuotes(path: string): string {
  return path.replace(/'/g, "'\"'\"'");
}

function downloadViaExec(
  session: SSHSession,
  filePath: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const escaped = escapeSingleQuotes(filePath);
    execChannel(session, `cat '${escaped}'`, (err, stream) => {
      if (err) return reject(err);
      const chunks: Buffer[] = [];
      let stderr = "";
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      stream.on("close", (code: number) => {
        if (code !== 0) {
          return reject(
            new Error(stderr.trim() || `cat exited with code ${code}`),
          );
        }
        resolve(Buffer.concat(chunks));
      });
      stream.on("error", reject);
    });
  });
}

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
   *     description: Downloads a file from the remote host. Uses SCP legacy mode (cat over exec) when the host has scpLegacy enabled, otherwise uses SFTP.
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

    if (sshConn.scpLegacy) {
      fileLogger.info(
        "Downloading file via legacy exec/cat (SCP legacy mode)",
        {
          operation: "file_download_legacy",
          sessionId,
          userId,
          path: filePath,
        },
      );

      try {
        const data = await downloadViaExec(sshConn, filePath);
        const fileName = filePath.split("/").pop() || "download";
        fileLogger.success("File download completed (legacy mode)", {
          operation: "file_download_complete",
          sessionId,
          userId,
          hostId,
          path: filePath,
          bytes: data.length,
          duration: Date.now() - downloadStartTime,
        });
        return res.json({
          content: data.toString("base64"),
          fileName,
          size: data.length,
          mimeType: getMimeType(fileName),
          path: filePath,
        });
      } catch (err) {
        fileLogger.error("Legacy exec/cat download failed:", err);
        return res.status(500).json({
          error: `Failed to download file: ${(err as Error).message}`,
        });
      }
    }

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

  /**
   * @openapi
   * /ssh/file_manager/ssh/downloadFileStream:
   *   post:
   *     summary: Stream-download a file
   *     description: Downloads a file as a binary stream. Uses SCP legacy mode (cat over exec) when the host has scpLegacy enabled, otherwise uses SFTP.
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
   *     responses:
   *       200:
   *         description: Binary file stream.
   *       400:
   *         description: Missing required parameters.
   *       500:
   *         description: Download failed.
   */
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

    const fileName = filePath.split("/").pop() || "download";
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );

    if (sshConn.scpLegacy) {
      fileLogger.info("Streaming file via legacy exec/cat (SCP legacy mode)", {
        operation: "file_download_stream_legacy",
        sessionId,
        userId,
        path: filePath,
      });

      const escaped = escapeSingleQuotes(filePath);
      execChannel(sshConn, `cat '${escaped}'`, (err, stream) => {
        if (err) {
          if (!res.headersSent) {
            res.status(500).json({ error: `Download failed: ${err.message}` });
          }
          return;
        }
        stream.on("error", (streamErr: Error) => {
          if (!res.headersSent) {
            res
              .status(500)
              .json({ error: `Download failed: ${streamErr.message}` });
          } else {
            res.destroy();
          }
        });
        stream.pipe(res);
      });
      return;
    }

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
