import type { Express } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { fileLogger } from "../utils/logger.js";
import {
  execChannel,
  execWithSudo,
  execWithSudoBuffer,
  getSessionSftp,
  type SSHSession,
} from "./file-manager-session.js";
import { detectBinary } from "./file-manager-utils.js";

type FileContentRoutesDeps = {
  sshSessions: Record<string, SSHSession>;
  verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
};

export function registerFileContentRoutes(
  app: Express,
  { sshSessions, verifySessionOwnership }: FileContentRoutesDeps,
): void {
  /**
   * @openapi
   * /ssh/file_manager/ssh/identifySymlink:
   *   get:
   *     summary: Identify symbolic link
   *     description: Identifies the target of a symbolic link.
   *     tags:
   *       - File Manager
   *     parameters:
   *       - in: query
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Symbolic link information.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       500:
   *         description: Failed to identify symbolic link.
   */
  app.get("/ssh/file_manager/ssh/identifySymlink", (req, res) => {
    const sessionId = req.query.sessionId as string;
    const sshConn = sshSessions[sessionId];
    const linkPath = decodeURIComponent(req.query.path as string);
    const userId = (req as AuthenticatedRequest).userId;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    if (!sshConn?.isConnected) {
      return res.status(400).json({ error: "SSH connection not established" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    if (!linkPath) {
      return res.status(400).json({ error: "Link path is required" });
    }

    sshConn.lastActive = Date.now();

    const escapedPath = linkPath.replace(/'/g, "'\"'\"'");
    const command = `stat -L -c "%F" '${escapedPath}' && readlink -f '${escapedPath}'`;

    execChannel(sshConn, command, (err, stream) => {
      if (err) {
        fileLogger.error("SSH identifySymlink error:", err);
        return res.status(500).json({ error: err.message });
      }

      let data = "";
      let errorData = "";

      stream.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        errorData += chunk.toString();
      });

      stream.on("close", (code) => {
        if (code !== 0) {
          fileLogger.error(
            `SSH identifySymlink command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
          );
          return res
            .status(500)
            .json({ error: `Command failed: ${errorData}` });
        }

        const [fileType, target] = data.trim().split("\n");

        res.json({
          path: linkPath,
          target: target,
          type: fileType.toLowerCase().includes("directory")
            ? "directory"
            : "file",
        });
      });

      stream.on("error", (streamErr) => {
        fileLogger.error("SSH identifySymlink stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/resolvePath:
   *   get:
   *     summary: Resolve a path with environment variables
   *     description: Expands environment variables and ~ in a path via the SSH session.
   *     tags:
   *       - File Manager
   *     parameters:
   *       - in: query
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The resolved absolute path.
   *       400:
   *         description: Missing required parameters.
   *       500:
   *         description: Failed to resolve path.
   */
  app.get("/ssh/file_manager/ssh/resolvePath", (req, res) => {
    const sessionId = req.query.sessionId as string;
    const sshConn = sshSessions[sessionId];
    const rawPath = decodeURIComponent(req.query.path as string);
    const userId = (req as AuthenticatedRequest).userId;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    if (!sshConn?.isConnected) {
      return res.status(400).json({ error: "SSH connection not established" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    if (!rawPath) {
      return res.status(400).json({ error: "Path is required" });
    }

    sshConn.lastActive = Date.now();

    let command: string;
    if (rawPath.startsWith("~")) {
      const rest = rawPath.substring(1).replace(/'/g, "'\"'\"'");
      command = `echo ~'${rest}'`;
    } else {
      const escapedPath = rawPath.replace(/'/g, "'\"'\"'");
      command = `echo '${escapedPath}'`;
    }

    execChannel(sshConn, command, (err, stream) => {
      if (err) {
        fileLogger.error("SSH resolvePath error:", err);
        return res.status(500).json({ error: err.message });
      }

      let data = "";
      let errorData = "";

      stream.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        errorData += chunk.toString();
      });

      stream.on("close", (code) => {
        if (code !== 0) {
          fileLogger.error(
            `SSH resolvePath command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
          );
          return res.json({ resolvedPath: rawPath });
        }

        const resolved = data.trim();
        res.json({ resolvedPath: resolved || rawPath });
      });

      stream.on("error", (streamErr) => {
        fileLogger.error("SSH resolvePath stream error:", streamErr);
        if (!res.headersSent) {
          res.json({ resolvedPath: rawPath });
        }
      });
    });
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/readFile:
   *   get:
   *     summary: Read a file
   *     description: Reads the content of a file from the remote host.
   *     tags:
   *       - File Manager
   *     parameters:
   *       - in: query
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The content of the file.
   *       400:
   *         description: Missing required parameters or file too large.
   *       404:
   *         description: File not found.
   *       500:
   *         description: Failed to read file.
   */
  app.get("/ssh/file_manager/ssh/readFile", (req, res) => {
    const sessionId = req.query.sessionId as string;
    const sshConn = sshSessions[sessionId];
    const filePath = decodeURIComponent(req.query.path as string);
    const userId = (req as AuthenticatedRequest).userId;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    if (!sshConn?.isConnected) {
      return res.status(400).json({ error: "SSH connection not established" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    fileLogger.info("Reading file", {
      operation: "file_read",
      sessionId,
      userId,
      path: filePath,
    });
    sshConn.lastActive = Date.now();

    const MAX_READ_SIZE = 500 * 1024 * 1024;
    const escapedPath = filePath.replace(/'/g, "'\"'\"'");

    execChannel(
      sshConn,
      `stat -c%s '${escapedPath}' 2>/dev/null || wc -c < '${escapedPath}'`,
      (sizeErr, sizeStream) => {
        if (sizeErr) {
          fileLogger.error("SSH file size check error:", sizeErr);
          return res.status(500).json({ error: sizeErr.message });
        }

        let sizeData = "";
        let sizeErrorData = "";

        sizeStream.on("data", (chunk: Buffer) => {
          sizeData += chunk.toString();
        });

        sizeStream.stderr.on("data", (chunk: Buffer) => {
          sizeErrorData += chunk.toString();
        });

        sizeStream.on("close", (sizeCode) => {
          if (sizeCode !== 0) {
            const errorLower = sizeErrorData.toLowerCase();
            const isFileNotFound =
              errorLower.includes("no such file or directory") ||
              errorLower.includes("cannot access") ||
              errorLower.includes("not found") ||
              errorLower.includes("resource not found");

            fileLogger.error(`File size check failed: ${sizeErrorData}`);
            return res.status(isFileNotFound ? 404 : 500).json({
              error: `Cannot check file size: ${sizeErrorData}`,
              fileNotFound: isFileNotFound,
            });
          }

          const fileSize = parseInt(sizeData.trim(), 10);

          if (isNaN(fileSize)) {
            fileLogger.error("Invalid file size response:", sizeData);
            return res
              .status(500)
              .json({ error: "Cannot determine file size" });
          }

          if (fileSize > MAX_READ_SIZE) {
            fileLogger.warn("File too large for reading", {
              operation: "file_read",
              sessionId,
              filePath,
              fileSize,
              maxSize: MAX_READ_SIZE,
            });
            return res.status(400).json({
              error: `File too large to open in editor. Maximum size is ${MAX_READ_SIZE / 1024 / 1024}MB, file is ${(fileSize / 1024 / 1024).toFixed(2)}MB. Use download instead.`,
              fileSize,
              maxSize: MAX_READ_SIZE,
              tooLarge: true,
            });
          }

          execChannel(sshConn, `cat '${escapedPath}'`, (err, stream) => {
            if (err) {
              fileLogger.error("SSH readFile error:", err);
              return res.status(500).json({ error: err.message });
            }

            let binaryData = Buffer.alloc(0);
            let errorData = "";

            stream.on("data", (chunk: Buffer) => {
              binaryData = Buffer.concat([binaryData, chunk]);
            });

            stream.stderr.on("data", (chunk: Buffer) => {
              errorData += chunk.toString();
            });

            stream.on("close", (code) => {
              if (code !== 0) {
                const isPermissionDenied = errorData
                  .toLowerCase()
                  .includes("permission denied");

                if (isPermissionDenied && sshConn.sudoPassword) {
                  execWithSudoBuffer(
                    sshConn,
                    `cat '${escapedPath}'`,
                    sshConn.sudoPassword,
                  )
                    .then((result) => {
                      if (result.code !== 0) {
                        return res.status(403).json({
                          error: `Permission denied: ${result.stderr || result.stdout.toString("utf8")}`,
                          needsSudo: true,
                        });
                      }

                      const sudoData = result.stdout;
                      const isBinary = detectBinary(sudoData);
                      res.json({
                        content: isBinary
                          ? sudoData.toString("base64")
                          : sudoData.toString("utf8"),
                        isBinary,
                        size: sudoData.length,
                      });
                    })
                    .catch(() => {
                      res
                        .status(403)
                        .json({ error: "Permission denied", needsSudo: true });
                    });
                  return;
                }

                fileLogger.error(
                  `SSH readFile command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
                );

                const isFileNotFound =
                  errorData.includes("No such file or directory") ||
                  errorData.includes("cannot access") ||
                  errorData.includes("not found");

                return res.status(isFileNotFound ? 404 : 500).json({
                  error: `Command failed: ${errorData}`,
                  fileNotFound: isFileNotFound,
                });
              }

              const isBinary = detectBinary(binaryData);
              fileLogger.success("File read successfully", {
                operation: "file_read_success",
                sessionId,
                userId,
                path: filePath,
                bytes: binaryData.length,
              });

              if (isBinary) {
                const base64Content = binaryData.toString("base64");
                res.json({
                  content: base64Content,
                  path: filePath,
                  encoding: "base64",
                });
              } else {
                const textContent = binaryData.toString("utf8");
                res.json({
                  content: textContent,
                  path: filePath,
                  encoding: "utf8",
                });
              }
            });
          });
        });
      },
    );
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/writeFile:
   *   post:
   *     summary: Write to a file
   *     description: Writes content to a file on the remote host and preserves the existing permissions when the file already exists.
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
   *               content:
   *                 type: string
   *     responses:
   *       200:
   *         description: File written successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       500:
   *         description: Failed to write file.
   */
  app.post("/ssh/file_manager/ssh/writeFile", async (req, res) => {
    const { sessionId, path: filePath, content } = req.body;
    const sshConn = sshSessions[sessionId];
    const userId = (req as AuthenticatedRequest).userId;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    if (!sshConn?.isConnected) {
      return res.status(400).json({ error: "SSH connection not established" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    if (content === undefined) {
      return res.status(400).json({ error: "File content is required" });
    }

    const contentLength =
      typeof content === "string" ? content.length : Buffer.byteLength(content);
    fileLogger.info("Writing file", {
      operation: "file_write",
      sessionId,
      userId,
      path: filePath,
      bytes: contentLength,
    });
    sshConn.lastActive = Date.now();

    let preservedMode: number | undefined;

    const restoreOriginalMode = (
      sftp: import("ssh2").SFTPWrapper | null,
      onComplete: () => void,
    ) => {
      if (preservedMode === undefined) {
        onComplete();
        return;
      }

      const permissions = preservedMode.toString(8);

      if (sftp) {
        sftp.chmod(filePath, preservedMode, (chmodErr) => {
          if (chmodErr) {
            fileLogger.warn("Failed to restore file permissions after save", {
              operation: "file_write_restore_permissions",
              sessionId,
              userId,
              path: filePath,
              permissions,
              error: chmodErr.message,
            });
          } else {
            fileLogger.info("Restored file permissions after save", {
              operation: "file_write_restore_permissions",
              sessionId,
              userId,
              path: filePath,
              permissions,
            });
          }

          onComplete();
        });
        return;
      }

      const escapedPath = filePath.replace(/'/g, "'\"'\"'");
      const chmodCommand = `chmod ${permissions} '${escapedPath}' && echo "SUCCESS"`;

      execChannel(sshConn, chmodCommand, (err, stream) => {
        if (err) {
          fileLogger.warn("Failed to restore file permissions after save", {
            operation: "file_write_restore_permissions",
            sessionId,
            userId,
            path: filePath,
            permissions,
            error: err.message,
          });
          onComplete();
          return;
        }

        let outputData = "";
        let errorData = "";

        stream.on("data", (chunk: Buffer) => {
          outputData += chunk.toString();
        });

        stream.stderr.on("data", (chunk: Buffer) => {
          errorData += chunk.toString();
        });

        stream.on("close", (code) => {
          if (outputData.includes("SUCCESS")) {
            fileLogger.info("Restored file permissions after save", {
              operation: "file_write_restore_permissions",
              sessionId,
              userId,
              path: filePath,
              permissions,
            });
          } else {
            fileLogger.warn("Failed to restore file permissions after save", {
              operation: "file_write_restore_permissions",
              sessionId,
              userId,
              path: filePath,
              permissions,
              exitCode: code,
              error:
                errorData ||
                "Permission restore command did not report success",
            });
          }

          onComplete();
        });

        stream.on("error", (streamErr) => {
          fileLogger.warn("Failed to restore file permissions after save", {
            operation: "file_write_restore_permissions",
            sessionId,
            userId,
            path: filePath,
            permissions,
            error: streamErr.message,
          });
          onComplete();
        });
      });
    };

    const trySFTP = () => {
      try {
        fileLogger.info("Opening SFTP channel", {
          operation: "file_sftp_open",
          sessionId,
          userId,
          path: filePath,
        });
        getSessionSftp(sshConn)
          .then((sftp) => {
            let fileBuffer;
            try {
              if (typeof content === "string") {
                try {
                  const testBuffer = Buffer.from(content, "base64");
                  if (testBuffer.toString("base64") === content) {
                    fileBuffer = testBuffer;
                  } else {
                    fileBuffer = Buffer.from(content, "utf8");
                  }
                } catch {
                  fileBuffer = Buffer.from(content, "utf8");
                }
              } else if (Buffer.isBuffer(content)) {
                fileBuffer = content;
              } else {
                fileBuffer = Buffer.from(content);
              }
            } catch (bufferErr) {
              fileLogger.error("Buffer conversion error:", bufferErr);
              if (!res.headersSent) {
                return res
                  .status(500)
                  .json({ error: "Invalid file content format" });
              }
              return;
            }

            sftp.stat(filePath, (statErr, stats) => {
              try {
                if (statErr) {
                  fileLogger.warn(
                    "Failed to read existing file permissions before save",
                    {
                      operation: "file_write_stat",
                      sessionId,
                      userId,
                      path: filePath,
                      error: statErr.message,
                    },
                  );
                } else if (stats.isFile()) {
                  preservedMode = stats.mode & 0o7777;
                }

                const writeStream = sftp.createWriteStream(filePath);

                let hasError = false;
                let hasFinished = false;
                let isFinalizing = false;

                const finalizeSuccess = () => {
                  if (hasError || hasFinished) return;
                  hasFinished = true;
                  isFinalizing = false;
                  fileLogger.success("File written successfully", {
                    operation: "file_write_success",
                    sessionId,
                    userId,
                    path: filePath,
                    bytes: fileBuffer.length,
                  });
                  if (!res.headersSent) {
                    res.json({
                      message: "File written successfully",
                      path: filePath,
                      toast: {
                        type: "success",
                        message: `File written: ${filePath}`,
                      },
                    });
                  }
                };

                writeStream.on("error", (streamErr) => {
                  if (hasError || hasFinished || isFinalizing) return;
                  hasError = true;
                  isFinalizing = false;
                  fileLogger.warn(
                    `SFTP write failed, trying fallback method: ${streamErr.message}`,
                  );
                  tryFallbackMethod();
                });

                const finishWrite = () => {
                  if (hasError || hasFinished || isFinalizing) return;
                  isFinalizing = true;
                  restoreOriginalMode(sftp, finalizeSuccess);
                };

                writeStream.on("finish", () => {
                  finishWrite();
                });

                writeStream.on("close", () => {
                  finishWrite();
                });

                try {
                  writeStream.write(fileBuffer);
                  writeStream.end();
                } catch (writeErr) {
                  if (hasError || hasFinished) return;
                  hasError = true;
                  isFinalizing = false;
                  fileLogger.warn(
                    `SFTP write operation failed, trying fallback method: ${(writeErr as Error).message}`,
                  );
                  tryFallbackMethod();
                }
              } catch (callbackErr) {
                fileLogger.warn(
                  `SFTP stat callback error, trying fallback method: ${(callbackErr as Error).message}`,
                );
                tryFallbackMethod();
              }
            });
          })
          .catch((err: Error) => {
            fileLogger.warn(
              `SFTP failed, trying fallback method: ${err.message}`,
            );
            tryFallbackMethod();
          });
      } catch (sftpErr) {
        fileLogger.warn(
          `SFTP connection error, trying fallback method: ${(sftpErr as Error).message}`,
        );
        tryFallbackMethod();
      }
    };

    const tryFallbackMethod = () => {
      if (!sshConn?.isConnected) {
        if (!res.headersSent) {
          return res.status(500).json({ error: "SSH session disconnected" });
        }
        return;
      }
      try {
        let contentBuffer: Buffer;
        if (typeof content === "string") {
          try {
            contentBuffer = Buffer.from(content, "base64");
            if (contentBuffer.toString("base64") !== content) {
              contentBuffer = Buffer.from(content, "utf8");
            }
          } catch {
            contentBuffer = Buffer.from(content, "utf8");
          }
        } else if (Buffer.isBuffer(content)) {
          contentBuffer = content;
        } else {
          contentBuffer = Buffer.from(content);
        }
        const base64Content = contentBuffer.toString("base64");
        const escapedPath = filePath.replace(/'/g, "'\"'\"'");

        const writeCommand = `echo '${base64Content}' | base64 -d > '${escapedPath}' && echo "SUCCESS"`;

        execChannel(sshConn, writeCommand, (err, stream) => {
          if (err) {
            fileLogger.error("Fallback write command failed:", err);
            if (!res.headersSent) {
              return res.status(500).json({
                error: `Write failed: ${err.message}`,
                toast: {
                  type: "error",
                  message: `Write failed: ${err.message}`,
                },
              });
            }
            return;
          }

          let outputData = "";
          let errorData = "";

          stream.on("data", (chunk: Buffer) => {
            outputData += chunk.toString();
          });

          stream.stderr.on("data", (chunk: Buffer) => {
            errorData += chunk.toString();
          });

          stream.stderr.on("error", (stderrErr) => {
            fileLogger.error("Fallback write stderr error:", stderrErr);
          });

          stream.on("close", (code) => {
            if (outputData.includes("SUCCESS")) {
              restoreOriginalMode(null, () => {
                if (!res.headersSent) {
                  res.json({
                    message: "File written successfully",
                    path: filePath,
                    toast: {
                      type: "success",
                      message: `File written: ${filePath}`,
                    },
                  });
                }
              });
            } else {
              const isPermDenied = errorData
                .toLowerCase()
                .includes("permission denied");
              if (isPermDenied && sshConn.sudoPassword) {
                execWithSudo(
                  sshConn,
                  `bash -c "echo '${base64Content}' | base64 -d > '${escapedPath}' && echo SUCCESS"`,
                  sshConn.sudoPassword,
                )
                  .then(({ stdout, code: sudoCode }) => {
                    if (sudoCode === 0 && stdout.includes("SUCCESS")) {
                      restoreOriginalMode(null, () => {
                        if (!res.headersSent) {
                          res.json({
                            message: "File written successfully",
                            path: filePath,
                          });
                        }
                      });
                    } else if (!res.headersSent) {
                      res
                        .status(403)
                        .json({ error: "Permission denied", needsSudo: true });
                    }
                  })
                  .catch(() => {
                    if (!res.headersSent) {
                      res
                        .status(403)
                        .json({ error: "Permission denied", needsSudo: true });
                    }
                  });
                return;
              }
              fileLogger.error(
                `Fallback write failed with code ${code}: ${errorData}`,
              );
              if (!res.headersSent) {
                res.status(500).json({
                  error: `Write failed: ${errorData}`,
                  needsSudo: isPermDenied,
                  toast: {
                    type: "error",
                    message: `Write failed: ${errorData}`,
                  },
                });
              }
            }
          });

          stream.on("error", (streamErr) => {
            fileLogger.error("Fallback write stream error:", streamErr);
            if (!res.headersSent) {
              res
                .status(500)
                .json({ error: `Write stream error: ${streamErr.message}` });
            }
          });
        });
      } catch (fallbackErr) {
        fileLogger.error("Fallback method failed:", fallbackErr);
        if (!res.headersSent) {
          res.status(500).json({
            error: `All write methods failed: ${(fallbackErr as Error).message}`,
          });
        }
      }
    };

    trySFTP();
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/uploadFile:
   *   post:
   *     summary: Upload a file
   *     description: Uploads a file to the remote host.
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
   *               content:
   *                 type: string
   *               fileName:
   *                 type: string
   *     responses:
   *       200:
   *         description: File uploaded successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       500:
   *         description: Failed to upload file.
   */
  app.post("/ssh/file_manager/ssh/uploadFile", async (req, res) => {
    const { sessionId, path: filePath, content, fileName } = req.body;
    const sshConn = sshSessions[sessionId];
    const userId = (req as AuthenticatedRequest).userId;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    if (!sshConn?.isConnected) {
      return res.status(400).json({ error: "SSH connection not established" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    if (!filePath || !fileName || content === undefined) {
      return res
        .status(400)
        .json({ error: "File path, name, and content are required" });
    }

    sshConn.lastActive = Date.now();

    const contentSize =
      typeof content === "string"
        ? Buffer.byteLength(content, "utf8")
        : content.length;

    const fullPath = filePath.endsWith("/")
      ? filePath + fileName
      : filePath + "/" + fileName;
    const uploadStartTime = Date.now();
    fileLogger.info("File upload started", {
      operation: "file_upload_start",
      sessionId,
      userId,
      path: fullPath,
      bytes: contentSize,
    });

    const trySFTP = () => {
      try {
        fileLogger.info("Opening SFTP channel", {
          operation: "file_sftp_open",
          sessionId,
          userId,
          path: fullPath,
        });
        getSessionSftp(sshConn)
          .then((sftp) => {
            let fileBuffer;
            try {
              if (typeof content === "string") {
                fileBuffer = Buffer.from(content, "base64");
              } else if (Buffer.isBuffer(content)) {
                fileBuffer = content;
              } else {
                fileBuffer = Buffer.from(content);
              }
            } catch (bufferErr) {
              fileLogger.error("Buffer conversion error:", bufferErr);
              if (!res.headersSent) {
                return res
                  .status(500)
                  .json({ error: "Invalid file content format" });
              }
              return;
            }

            const writeStream = sftp.createWriteStream(fullPath);

            let hasError = false;
            let hasFinished = false;

            writeStream.on("error", (streamErr) => {
              if (hasError || hasFinished) return;
              hasError = true;
              fileLogger.warn(
                `SFTP write failed, trying fallback method: ${streamErr.message}`,
                {
                  operation: "file_upload",
                  sessionId,
                  fileName,
                  fileSize: contentSize,
                  error: streamErr.message,
                },
              );
              tryFallbackMethod();
            });

            writeStream.on("finish", () => {
              if (hasError || hasFinished) return;
              hasFinished = true;
              fileLogger.success("File upload completed", {
                operation: "file_upload_complete",
                sessionId,
                userId,
                path: fullPath,
                bytes: fileBuffer.length,
                duration: Date.now() - uploadStartTime,
              });
              if (!res.headersSent) {
                res.json({
                  message: "File uploaded successfully",
                  path: fullPath,
                  toast: {
                    type: "success",
                    message: `File uploaded: ${fullPath}`,
                  },
                });
              }
            });

            writeStream.on("close", () => {
              if (hasError || hasFinished) return;
              hasFinished = true;
              fileLogger.success("File upload completed", {
                operation: "file_upload_complete",
                sessionId,
                userId,
                path: fullPath,
                bytes: fileBuffer.length,
                duration: Date.now() - uploadStartTime,
              });
              if (!res.headersSent) {
                res.json({
                  message: "File uploaded successfully",
                  path: fullPath,
                  toast: {
                    type: "success",
                    message: `File uploaded: ${fullPath}`,
                  },
                });
              }
            });

            try {
              writeStream.write(fileBuffer);
              writeStream.end();
            } catch (writeErr) {
              if (hasError || hasFinished) return;
              hasError = true;
              fileLogger.warn(
                `SFTP write operation failed, trying fallback method: ${(writeErr as Error).message}`,
              );
              tryFallbackMethod();
            }
          })
          .catch((err: Error) => {
            fileLogger.warn(
              `SFTP failed, trying fallback method: ${err.message}`,
            );
            tryFallbackMethod();
          });
      } catch (sftpErr) {
        fileLogger.warn(
          `SFTP connection error, trying fallback method: ${(sftpErr as Error).message}`,
        );
        tryFallbackMethod();
      }
    };

    const tryFallbackMethod = () => {
      if (!sshConn?.isConnected) {
        if (!res.headersSent) {
          return res.status(500).json({ error: "SSH session disconnected" });
        }
        return;
      }
      try {
        let contentBuffer: Buffer;
        if (typeof content === "string") {
          try {
            contentBuffer = Buffer.from(content, "base64");
            if (contentBuffer.toString("base64") !== content) {
              contentBuffer = Buffer.from(content, "utf8");
            }
          } catch {
            contentBuffer = Buffer.from(content, "utf8");
          }
        } else if (Buffer.isBuffer(content)) {
          contentBuffer = content;
        } else {
          contentBuffer = Buffer.from(content);
        }
        const base64Content = contentBuffer.toString("base64");
        const chunkSize = 1000000;
        const chunks = [];

        for (let i = 0; i < base64Content.length; i += chunkSize) {
          chunks.push(base64Content.slice(i, i + chunkSize));
        }

        if (!sshConn?.isConnected) {
          fileLogger.error("SSH connection lost before fallback upload", {
            operation: "file_upload_fallback",
            sessionId,
            path: fullPath,
          });
          if (!res.headersSent) {
            return res
              .status(500)
              .json({ error: "SSH connection lost during upload" });
          }
          return;
        }

        if (chunks.length === 1) {
          const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

          const writeCommand = `echo '${chunks[0]}' | base64 -d > '${escapedPath}' && echo "SUCCESS"`;

          execChannel(sshConn, writeCommand, (err, stream) => {
            if (err) {
              fileLogger.error("Fallback upload command failed:", err);
              if (!res.headersSent) {
                return res
                  .status(500)
                  .json({ error: `Upload failed: ${err.message}` });
              }
              return;
            }

            let outputData = "";
            let errorData = "";

            stream.on("data", (chunk: Buffer) => {
              outputData += chunk.toString();
            });

            stream.stderr.on("data", (chunk: Buffer) => {
              errorData += chunk.toString();
            });

            stream.stderr.on("error", (stderrErr) => {
              fileLogger.error("Fallback upload stderr error:", stderrErr);
            });

            stream.on("close", (code) => {
              if (outputData.includes("SUCCESS")) {
                if (!res.headersSent) {
                  res.json({
                    message: "File uploaded successfully",
                    path: fullPath,
                    toast: {
                      type: "success",
                      message: `File uploaded: ${fullPath}`,
                    },
                  });
                }
              } else {
                fileLogger.error(
                  `Fallback upload failed with code ${code}: ${errorData}`,
                );
                if (!res.headersSent) {
                  res.status(500).json({
                    error: `Upload failed: ${errorData}`,
                    toast: {
                      type: "error",
                      message: `Upload failed: ${errorData}`,
                    },
                  });
                }
              }
            });

            stream.on("error", (streamErr) => {
              fileLogger.error("Fallback upload stream error:", streamErr);
              if (!res.headersSent) {
                res
                  .status(500)
                  .json({ error: `Upload stream error: ${streamErr.message}` });
              }
            });
          });
        } else {
          const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

          let writeCommand = `> '${escapedPath}'`;

          chunks.forEach((chunk) => {
            writeCommand += ` && echo '${chunk}' | base64 -d >> '${escapedPath}'`;
          });

          writeCommand += ` && echo "SUCCESS"`;

          execChannel(sshConn, writeCommand, (err, stream) => {
            if (err) {
              fileLogger.error("Chunked fallback upload failed:", err);
              if (!res.headersSent) {
                return res
                  .status(500)
                  .json({ error: `Chunked upload failed: ${err.message}` });
              }
              return;
            }

            let outputData = "";
            let errorData = "";

            stream.on("data", (chunk: Buffer) => {
              outputData += chunk.toString();
            });

            stream.stderr.on("data", (chunk: Buffer) => {
              errorData += chunk.toString();
            });

            stream.stderr.on("error", (stderrErr) => {
              fileLogger.error(
                "Chunked fallback upload stderr error:",
                stderrErr,
              );
            });

            stream.on("close", (code) => {
              if (outputData.includes("SUCCESS")) {
                if (!res.headersSent) {
                  res.json({
                    message: "File uploaded successfully",
                    path: fullPath,
                    toast: {
                      type: "success",
                      message: `File uploaded: ${fullPath}`,
                    },
                  });
                }
              } else {
                fileLogger.error(
                  `Chunked fallback upload failed with code ${code}: ${errorData}`,
                );
                if (!res.headersSent) {
                  res.status(500).json({
                    error: `Chunked upload failed: ${errorData}`,
                    toast: {
                      type: "error",
                      message: `Chunked upload failed: ${errorData}`,
                    },
                  });
                }
              }
            });

            stream.on("error", (streamErr) => {
              fileLogger.error(
                "Chunked fallback upload stream error:",
                streamErr,
              );
              if (!res.headersSent) {
                res.status(500).json({
                  error: `Chunked upload stream error: ${streamErr.message}`,
                });
              }
            });
          });
        }
      } catch (fallbackErr) {
        fileLogger.error("Fallback method failed:", fallbackErr);
        if (!res.headersSent) {
          res.status(500).json({
            error: `All upload methods failed: ${fallbackErr.message}`,
          });
        }
      }
    };

    trySFTP();
  });
}
