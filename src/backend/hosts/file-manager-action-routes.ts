import type { Express } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { fileLogger } from "../utils/logger.js";
import { execChannel, type SSHSession } from "./file-manager-session.js";

type FileActionRoutesDeps = {
  sshSessions: Record<string, SSHSession>;
  scheduleSessionCleanup: (sessionId: string) => void;
  verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
};

export function registerFileActionRoutes(
  app: Express,
  {
    sshSessions,
    scheduleSessionCleanup,
    verifySessionOwnership,
  }: FileActionRoutesDeps,
): void {
  /**
   * @openapi
   * /ssh/file_manager/ssh/copyItem:
   *   post:
   *     summary: Copy a file or directory
   *     description: Copies a file or directory on the remote host.
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
   *               sourcePath:
   *                 type: string
   *               targetDir:
   *                 type: string
   *               hostId:
   *                 type: integer
   *               userId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Item copied successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       500:
   *         description: Failed to copy item.
   */
  app.post("/ssh/file_manager/ssh/copyItem", async (req, res) => {
    const { sessionId, sourcePath, targetDir, hostId } = req.body;
    const userId = (req as AuthenticatedRequest).userId;

    if (!sessionId || !sourcePath || !targetDir) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const sshConn = sshSessions[sessionId];
    if (!sshConn || !sshConn.isConnected) {
      return res
        .status(400)
        .json({ error: "SSH session not found or not connected" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    sshConn.lastActive = Date.now();
    scheduleSessionCleanup(sessionId);

    const sourceName = sourcePath.split("/").pop() || "copied_item";

    const timestamp = Date.now().toString().slice(-8);
    const uniqueName = `${sourceName}_copy_${timestamp}`;
    const targetPath = `${targetDir}/${uniqueName}`;

    const escapedSource = sourcePath.replace(/'/g, "'\"'\"'");
    const escapedTarget = targetPath.replace(/'/g, "'\"'\"'");

    const copyCommand = `cp '${escapedSource}' '${escapedTarget}' && echo "COPY_SUCCESS"`;

    const commandTimeout = setTimeout(() => {
      fileLogger.error("Copy command timed out after 60 seconds", {
        sourcePath,
        targetPath,
        command: copyCommand,
      });
      if (!res.headersSent) {
        res.status(500).json({
          error: "Copy operation timed out",
          toast: {
            type: "error",
            message:
              "Copy operation timed out. SSH connection may be unstable.",
          },
        });
      }
    }, 60000);

    execChannel(sshConn, copyCommand, (err, stream) => {
      if (err) {
        clearTimeout(commandTimeout);
        fileLogger.error("SSH copyItem error:", err);
        if (!res.headersSent) {
          return res.status(500).json({ error: err.message });
        }
        return;
      }

      let errorData = "";
      let stdoutData = "";

      stream.on("data", (data: Buffer) => {
        const output = data.toString();
        stdoutData += output;
        stream.stderr.on("data", (data: Buffer) => {
          const output = data.toString();
          errorData += output;
        });

        stream.on("close", (code) => {
          clearTimeout(commandTimeout);

          if (code !== 0) {
            const fullErrorInfo =
              errorData || stdoutData || "No error message available";
            fileLogger.error(`SSH copyItem command failed with code ${code}`, {
              operation: "file_copy_failed",
              sessionId,
              sourcePath,
              targetPath,
              command: copyCommand,
              exitCode: code,
              errorData,
              stdoutData,
              fullErrorInfo,
            });
            if (!res.headersSent) {
              return res.status(500).json({
                error: `Copy failed: ${fullErrorInfo}`,
                toast: {
                  type: "error",
                  message: `Copy failed: ${fullErrorInfo}`,
                },
                debug: {
                  sourcePath,
                  targetPath,
                  exitCode: code,
                  command: copyCommand,
                },
              });
            }
            return;
          }

          const copySuccessful =
            stdoutData.includes("COPY_SUCCESS") || code === 0;

          if (copySuccessful) {
            fileLogger.success("Item copied successfully", {
              operation: "file_copy",
              sessionId,
              sourcePath,
              targetPath,
              uniqueName,
              hostId,
              userId,
            });

            if (!res.headersSent) {
              res.json({
                message: "Item copied successfully",
                sourcePath,
                targetPath,
                uniqueName,
                toast: {
                  type: "success",
                  message: `Successfully copied to: ${uniqueName}`,
                },
              });
            }
          } else {
            fileLogger.warn("Copy completed but without success confirmation", {
              operation: "file_copy_uncertain",
              sessionId,
              sourcePath,
              targetPath,
              code,
              stdoutData: stdoutData.substring(0, 200),
            });

            if (!res.headersSent) {
              res.json({
                message: "Copy may have completed",
                sourcePath,
                targetPath,
                uniqueName,
                toast: {
                  type: "warning",
                  message: `Copy completed but verification uncertain for: ${uniqueName}`,
                },
              });
            }
          }
        });

        stream.on("error", (streamErr) => {
          clearTimeout(commandTimeout);
          fileLogger.error("SSH copyItem stream error:", streamErr);
          if (!res.headersSent) {
            res
              .status(500)
              .json({ error: `Stream error: ${streamErr.message}` });
          }
        });
      });
    });
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/executeFile:
   *   post:
   *     summary: Execute a file
   *     description: Executes a file on the remote host.
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
   *               filePath:
   *                 type: string
   *     responses:
   *       200:
   *         description: File execution result.
   *       400:
   *         description: Missing required parameters or SSH connection not available.
   *       500:
   *         description: Failed to execute file.
   */
  app.post("/ssh/file_manager/ssh/executeFile", async (req, res) => {
    const { sessionId, filePath } = req.body;
    const sshConn = sshSessions[sessionId];
    const userId = (req as AuthenticatedRequest).userId;

    if (!sshConn || !sshConn.isConnected) {
      fileLogger.error(
        "SSH connection not found or not connected for executeFile",
        {
          operation: "execute_file",
          sessionId,
          hasConnection: !!sshConn,
          isConnected: sshConn?.isConnected,
        },
      );
      return res.status(400).json({ error: "SSH connection not available" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    const escapedPath = filePath.replace(/'/g, "'\"'\"'");

    const checkCommand = `test -x '${escapedPath}' && echo "EXECUTABLE" || echo "NOT_EXECUTABLE"`;

    execChannel(sshConn, checkCommand, (checkErr, checkStream) => {
      if (checkErr) {
        fileLogger.error("SSH executeFile check error:", checkErr);
        return res
          .status(500)
          .json({ error: "Failed to check file executability" });
      }

      let checkResult = "";
      checkStream.on("data", (data) => {
        checkResult += data.toString();
      });

      checkStream.on("close", () => {
        if (!checkResult.includes("EXECUTABLE")) {
          return res.status(400).json({ error: "File is not executable" });
        }

        const executeCommand = `cd "$(dirname '${escapedPath}')" && '${escapedPath}' 2>&1; echo "EXIT_CODE:$?"`;

        execChannel(sshConn, executeCommand, (err, stream) => {
          if (err) {
            fileLogger.error("SSH executeFile error:", err);
            return res.status(500).json({ error: "Failed to execute file" });
          }

          let output = "";
          let errorOutput = "";

          stream.on("data", (data) => {
            output += data.toString();
          });

          stream.stderr.on("data", (data) => {
            errorOutput += data.toString();
          });

          stream.on("close", (code) => {
            const exitCodeMatch = output.match(/EXIT_CODE:(\d+)$/);
            const actualExitCode = exitCodeMatch
              ? parseInt(exitCodeMatch[1])
              : code;
            const cleanOutput = output.replace(/EXIT_CODE:\d+$/, "").trim();

            fileLogger.info("File execution completed", {
              operation: "execute_file",
              sessionId,
              filePath,
              exitCode: actualExitCode,
              outputLength: cleanOutput.length,
              errorLength: errorOutput.length,
            });

            res.json({
              success: true,
              exitCode: actualExitCode,
              output: cleanOutput,
              error: errorOutput,
              timestamp: new Date().toISOString(),
            });
          });

          stream.on("error", (streamErr) => {
            fileLogger.error("SSH executeFile stream error:", streamErr);
            if (!res.headersSent) {
              res.status(500).json({ error: "Execution stream error" });
            }
          });
        });
      });
    });
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/changePermissions:
   *   post:
   *     summary: Change file permissions
   *     description: Changes the permissions of a file on the remote host.
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
   *               permissions:
   *                 type: string
   *     responses:
   *       200:
   *         description: Permissions changed successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not available.
   *       408:
   *         description: Permission change timed out.
   *       500:
   *         description: Failed to change permissions.
   */
  app.post("/ssh/file_manager/ssh/changePermissions", async (req, res) => {
    const { sessionId, path, permissions } = req.body;
    const sshConn = sshSessions[sessionId];
    const userId = (req as AuthenticatedRequest).userId;

    if (!sshConn || !sshConn.isConnected) {
      fileLogger.error(
        "SSH connection not found or not connected for changePermissions",
        {
          operation: "change_permissions",
          sessionId,
          hasConnection: !!sshConn,
          isConnected: sshConn?.isConnected,
        },
      );
      return res.status(400).json({ error: "SSH connection not available" });
    }

    if (!verifySessionOwnership(sshConn, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    if (!path) {
      return res.status(400).json({ error: "File path is required" });
    }

    if (!permissions || !/^\d{3,4}$/.test(permissions)) {
      return res.status(400).json({
        error: "Valid permissions required (e.g., 755, 644)",
      });
    }

    sshConn.lastActive = Date.now();
    scheduleSessionCleanup(sessionId);

    const octalPerms = permissions.slice(-3);
    const escapedPath = path.replace(/'/g, "'\"'\"'");
    const command = `chmod ${octalPerms} '${escapedPath}' && echo "SUCCESS"`;

    fileLogger.info("Changing file permissions", {
      operation: "change_permissions",
      sessionId,
      path,
      permissions: octalPerms,
    });

    const commandTimeout = setTimeout(() => {
      if (!res.headersSent) {
        fileLogger.error("changePermissions command timeout", {
          operation: "change_permissions",
          sessionId,
          path,
          permissions: octalPerms,
        });
        res.status(408).json({
          error: "Permission change timed out. SSH connection may be unstable.",
        });
      }
    }, 10000);

    execChannel(sshConn, command, (err, stream) => {
      if (err) {
        clearTimeout(commandTimeout);
        fileLogger.error("SSH changePermissions exec error:", err, {
          operation: "change_permissions",
          sessionId,
          path,
          permissions: octalPerms,
        });
        if (!res.headersSent) {
          return res
            .status(500)
            .json({ error: "Failed to change permissions" });
        }
        return;
      }

      let outputData = "";
      let errorOutput = "";

      stream.on("data", (chunk: Buffer) => {
        outputData += chunk.toString();
      });

      stream.stderr.on("data", (data: Buffer) => {
        errorOutput += data.toString();
      });

      stream.on("close", (code) => {
        clearTimeout(commandTimeout);

        if (outputData.includes("SUCCESS")) {
          fileLogger.success("File permissions changed successfully", {
            operation: "change_permissions",
            sessionId,
            path,
            permissions: octalPerms,
          });

          if (!res.headersSent) {
            res.json({
              success: true,
              message: "Permissions changed successfully",
            });
          }
          return;
        }

        if (code !== 0) {
          fileLogger.error("chmod command failed", {
            operation: "change_permissions",
            sessionId,
            path,
            permissions: octalPerms,
            exitCode: code,
            error: errorOutput,
          });
          if (!res.headersSent) {
            return res.status(500).json({
              error: errorOutput || "Failed to change permissions",
            });
          }
          return;
        }

        fileLogger.success("File permissions changed successfully", {
          operation: "change_permissions",
          sessionId,
          path,
          permissions: octalPerms,
        });

        if (!res.headersSent) {
          res.json({
            success: true,
            message: "Permissions changed successfully",
          });
        }
      });

      stream.on("error", (streamErr) => {
        clearTimeout(commandTimeout);
        fileLogger.error("SSH changePermissions stream error:", streamErr, {
          operation: "change_permissions",
          sessionId,
          path,
          permissions: octalPerms,
        });
        if (!res.headersSent) {
          res
            .status(500)
            .json({ error: "Stream error while changing permissions" });
        }
      });
    });
  });
}
