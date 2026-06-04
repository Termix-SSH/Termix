import type { Express } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { fileLogger } from "../utils/logger.js";
import {
  execChannel,
  execWithSudo,
  type SSHSession,
} from "./file-manager-session.js";

type FileOperationRoutesDeps = {
  sshSessions: Record<string, SSHSession>;
  verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
};

export function registerFileOperationRoutes(
  app: Express,
  { sshSessions, verifySessionOwnership }: FileOperationRoutesDeps,
): void {
  /**
   * @openapi
   * /ssh/file_manager/ssh/createFile:
   *   post:
   *     summary: Create a file
   *     description: Creates an empty file on the remote host.
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
   *               fileName:
   *                 type: string
   *     responses:
   *       200:
   *         description: File created successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       403:
   *         description: Permission denied.
   *       500:
   *         description: Failed to create file.
   */
  app.post("/ssh/file_manager/ssh/createFile", async (req, res) => {
    const { sessionId, path: filePath, fileName } = req.body;
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

    if (!filePath || !fileName) {
      return res.status(400).json({ error: "File path and name are required" });
    }

    sshConn.lastActive = Date.now();

    const fullPath = filePath.endsWith("/")
      ? filePath + fileName
      : filePath + "/" + fileName;
    const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

    const createCommand = `touch '${escapedPath}' && echo "SUCCESS" && exit 0`;

    execChannel(sshConn, createCommand, (err, stream) => {
      if (err) {
        fileLogger.error("SSH createFile error:", err);
        if (!res.headersSent) {
          return res.status(500).json({ error: err.message });
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

        if (chunk.toString().includes("Permission denied")) {
          fileLogger.error(`Permission denied creating file: ${fullPath}`);
          if (!res.headersSent) {
            return res.status(403).json({
              error: `Permission denied: Cannot create file ${fullPath}. Check directory permissions.`,
            });
          }
          return;
        }
      });

      stream.on("close", (code) => {
        if (outputData.includes("SUCCESS")) {
          if (!res.headersSent) {
            res.json({
              message: "File created successfully",
              path: fullPath,
              toast: { type: "success", message: `File created: ${fullPath}` },
            });
          }
          return;
        }

        if (code !== 0) {
          fileLogger.error(
            `SSH createFile command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
          );
          if (!res.headersSent) {
            return res.status(500).json({
              error: `Command failed: ${errorData}`,
              toast: {
                type: "error",
                message: `File creation failed: ${errorData}`,
              },
            });
          }
          return;
        }

        if (!res.headersSent) {
          res.json({
            message: "File created successfully",
            path: fullPath,
            toast: { type: "success", message: `File created: ${fullPath}` },
          });
        }
      });

      stream.on("error", (streamErr) => {
        fileLogger.error("SSH createFile stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/createFolder:
   *   post:
   *     summary: Create a folder
   *     description: Creates a new folder on the remote host.
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
   *               folderName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Folder created successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       403:
   *         description: Permission denied.
   *       500:
   *         description: Failed to create folder.
   */
  app.post("/ssh/file_manager/ssh/createFolder", async (req, res) => {
    const { sessionId, path: folderPath, folderName } = req.body;
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

    if (!folderPath || !folderName) {
      return res
        .status(400)
        .json({ error: "Folder path and name are required" });
    }

    sshConn.lastActive = Date.now();

    const fullPath = folderPath.endsWith("/")
      ? folderPath + folderName
      : folderPath + "/" + folderName;
    fileLogger.info("Creating directory", {
      operation: "file_mkdir",
      sessionId,
      userId,
      path: fullPath,
    });
    const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

    const createCommand = `mkdir -p '${escapedPath}' && echo "SUCCESS" && exit 0`;

    execChannel(sshConn, createCommand, (err, stream) => {
      if (err) {
        fileLogger.error("SSH createFolder error:", err);
        if (!res.headersSent) {
          return res.status(500).json({ error: err.message });
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

        if (chunk.toString().includes("Permission denied")) {
          fileLogger.error(`Permission denied creating folder: ${fullPath}`);
          if (!res.headersSent) {
            return res.status(403).json({
              error: `Permission denied: Cannot create folder ${fullPath}. Check directory permissions.`,
            });
          }
          return;
        }
      });

      stream.on("close", (code) => {
        if (outputData.includes("SUCCESS")) {
          fileLogger.success("Directory created successfully", {
            operation: "file_mkdir_success",
            sessionId,
            userId,
            path: fullPath,
          });
          if (!res.headersSent) {
            res.json({
              message: "Folder created successfully",
              path: fullPath,
              toast: {
                type: "success",
                message: `Folder created: ${fullPath}`,
              },
            });
          }
          return;
        }

        if (code !== 0) {
          fileLogger.error(
            `SSH createFolder command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
          );
          if (!res.headersSent) {
            return res.status(500).json({
              error: `Command failed: ${errorData}`,
              toast: {
                type: "error",
                message: `Folder creation failed: ${errorData}`,
              },
            });
          }
          return;
        }

        fileLogger.success("Directory created successfully", {
          operation: "file_mkdir_success",
          sessionId,
          userId,
          path: fullPath,
        });
        if (!res.headersSent) {
          res.json({
            message: "Folder created successfully",
            path: fullPath,
            toast: { type: "success", message: `Folder created: ${fullPath}` },
          });
        }
      });

      stream.on("error", (streamErr) => {
        fileLogger.error("SSH createFolder stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/deleteItem:
   *   delete:
   *     summary: Delete a file or directory
   *     description: Deletes a file or directory on the remote host.
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
   *               isDirectory:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Item deleted successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       403:
   *         description: Permission denied.
   *       500:
   *         description: Failed to delete item.
   */
  app.delete("/ssh/file_manager/ssh/deleteItem", async (req, res) => {
    const { sessionId, path: itemPath, isDirectory } = req.body;
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

    if (!itemPath) {
      return res.status(400).json({ error: "Item path is required" });
    }

    fileLogger.info("Deleting item", {
      operation: "file_delete",
      sessionId,
      userId,
      path: itemPath,
      type: isDirectory ? "directory" : "file",
    });
    sshConn.lastActive = Date.now();
    const escapedPath = itemPath.replace(/'/g, "'\"'\"'");

    const deleteCommand = isDirectory
      ? `rm -rf '${escapedPath}'`
      : `rm -f '${escapedPath}'`;

    const executeDelete = (useSudo: boolean): Promise<void> => {
      return new Promise((resolve) => {
        if (useSudo && sshConn.sudoPassword) {
          execWithSudo(sshConn, deleteCommand, sshConn.sudoPassword).then(
            (result) => {
              if (
                result.code === 0 ||
                (!result.stderr.includes("Permission denied") &&
                  !result.stdout.includes("Permission denied"))
              ) {
                res.json({
                  message: "Item deleted successfully",
                  path: itemPath,
                  toast: {
                    type: "success",
                    message: `${isDirectory ? "Directory" : "File"} deleted: ${itemPath}`,
                  },
                });
              } else {
                res.status(500).json({
                  error: `Delete failed: ${result.stderr || result.stdout}`,
                });
              }
              resolve();
            },
          );
          return;
        }

        execChannel(
          sshConn,
          `${deleteCommand} && echo "SUCCESS"`,
          (err, stream) => {
            if (err) {
              fileLogger.error("SSH deleteItem error:", err);
              res.status(500).json({ error: err.message });
              resolve();
              return;
            }

            let outputData = "";
            let errorData = "";
            let permissionDenied = false;

            stream.on("data", (chunk: Buffer) => {
              outputData += chunk.toString();
            });

            stream.stderr.on("data", (chunk: Buffer) => {
              errorData += chunk.toString();
              if (chunk.toString().includes("Permission denied")) {
                permissionDenied = true;
              }
            });

            stream.on("close", (code) => {
              if (permissionDenied) {
                if (sshConn.sudoPassword) {
                  executeDelete(true).then(resolve);
                  return;
                }
                fileLogger.error(`Permission denied deleting: ${itemPath}`);
                res.status(403).json({
                  error: `Permission denied: Cannot delete ${itemPath}.`,
                  needsSudo: true,
                });
                resolve();
                return;
              }

              if (outputData.includes("SUCCESS") || code === 0) {
                fileLogger.success("Item deleted successfully", {
                  operation: "file_delete_success",
                  sessionId,
                  userId,
                  path: itemPath,
                });
                res.json({
                  message: "Item deleted successfully",
                  path: itemPath,
                  toast: {
                    type: "success",
                    message: `${isDirectory ? "Directory" : "File"} deleted: ${itemPath}`,
                  },
                });
              } else {
                res.status(500).json({
                  error: `Command failed: ${errorData}`,
                });
              }
              resolve();
            });

            stream.on("error", (streamErr) => {
              fileLogger.error("SSH deleteItem stream error:", streamErr);
              res
                .status(500)
                .json({ error: `Stream error: ${streamErr.message}` });
              resolve();
            });
          },
        );
      });
    };

    await executeDelete(false);
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/renameItem:
   *   put:
   *     summary: Rename a file or directory
   *     description: Renames a file or directory on the remote host.
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
   *               oldPath:
   *                 type: string
   *               newName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Item renamed successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       403:
   *         description: Permission denied.
   *       500:
   *         description: Failed to rename item.
   */
  app.put("/ssh/file_manager/ssh/renameItem", async (req, res) => {
    const { sessionId, oldPath, newName } = req.body;
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

    if (!oldPath || !newName) {
      return res
        .status(400)
        .json({ error: "Old path and new name are required" });
    }

    sshConn.lastActive = Date.now();

    const oldDir = oldPath.substring(0, oldPath.lastIndexOf("/") + 1);
    const newPath = oldDir + newName;
    fileLogger.info("Renaming item", {
      operation: "file_rename",
      sessionId,
      userId,
      from: oldPath,
      to: newPath,
    });
    const escapedOldPath = oldPath.replace(/'/g, "'\"'\"'");
    const escapedNewPath = newPath.replace(/'/g, "'\"'\"'");

    const renameCommand = `mv '${escapedOldPath}' '${escapedNewPath}' && echo "SUCCESS" && exit 0`;

    execChannel(sshConn, renameCommand, (err, stream) => {
      if (err) {
        fileLogger.error("SSH renameItem error:", err);
        if (!res.headersSent) {
          return res.status(500).json({ error: err.message });
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

        if (chunk.toString().includes("Permission denied")) {
          fileLogger.error(`Permission denied renaming: ${oldPath}`);
          if (!res.headersSent) {
            return res.status(403).json({
              error: `Permission denied: Cannot rename ${oldPath}. Check file permissions.`,
            });
          }
          return;
        }
      });

      stream.on("close", (code) => {
        if (outputData.includes("SUCCESS")) {
          fileLogger.success("Item renamed successfully", {
            operation: "file_rename_success",
            sessionId,
            userId,
            from: oldPath,
            to: newPath,
          });
          if (!res.headersSent) {
            res.json({
              message: "Item renamed successfully",
              oldPath,
              newPath,
              toast: {
                type: "success",
                message: `Item renamed: ${oldPath} -> ${newPath}`,
              },
            });
          }
          return;
        }

        if (code !== 0) {
          fileLogger.error(
            `SSH renameItem command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
          );
          if (!res.headersSent) {
            return res.status(500).json({
              error: `Command failed: ${errorData}`,
              toast: { type: "error", message: `Rename failed: ${errorData}` },
            });
          }
          return;
        }

        fileLogger.success("Item renamed successfully", {
          operation: "file_rename_success",
          sessionId,
          userId,
          from: oldPath,
          to: newPath,
        });
        if (!res.headersSent) {
          res.json({
            message: "Item renamed successfully",
            oldPath,
            newPath,
            toast: {
              type: "success",
              message: `Item renamed: ${oldPath} -> ${newPath}`,
            },
          });
        }
      });

      stream.on("error", (streamErr) => {
        fileLogger.error("SSH renameItem stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  });

  /**
   * @openapi
   * /ssh/file_manager/ssh/moveItem:
   *   put:
   *     summary: Move a file or directory
   *     description: Moves a file or directory on the remote host.
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
   *               oldPath:
   *                 type: string
   *               newPath:
   *                 type: string
   *     responses:
   *       200:
   *         description: Item moved successfully.
   *       400:
   *         description: Missing required parameters or SSH connection not established.
   *       403:
   *         description: Permission denied.
   *       408:
   *         description: Move operation timed out.
   *       500:
   *         description: Failed to move item.
   */
  app.put("/ssh/file_manager/ssh/moveItem", async (req, res) => {
    const { sessionId, oldPath, newPath } = req.body;
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

    if (!oldPath || !newPath) {
      return res
        .status(400)
        .json({ error: "Old path and new path are required" });
    }

    sshConn.lastActive = Date.now();

    const escapedOldPath = oldPath.replace(/'/g, "'\"'\"'");
    const escapedNewPath = newPath.replace(/'/g, "'\"'\"'");

    const moveCommand = `mv '${escapedOldPath}' '${escapedNewPath}' && echo "SUCCESS" && exit 0`;

    const commandTimeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          error: "Move operation timed out. SSH connection may be unstable.",
          toast: {
            type: "error",
            message:
              "Move operation timed out. SSH connection may be unstable.",
          },
        });
      }
    }, 60000);

    execChannel(sshConn, moveCommand, (err, stream) => {
      if (err) {
        clearTimeout(commandTimeout);
        fileLogger.error("SSH moveItem error:", err);
        if (!res.headersSent) {
          return res.status(500).json({ error: err.message });
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

        if (chunk.toString().includes("Permission denied")) {
          fileLogger.error(`Permission denied moving: ${oldPath}`);
          if (!res.headersSent) {
            return res.status(403).json({
              error: `Permission denied: Cannot move ${oldPath}. Check file permissions.`,
              toast: {
                type: "error",
                message: `Permission denied: Cannot move ${oldPath}. Check file permissions.`,
              },
            });
          }
          return;
        }
      });

      stream.on("close", (code) => {
        clearTimeout(commandTimeout);
        if (outputData.includes("SUCCESS")) {
          if (!res.headersSent) {
            res.json({
              message: "Item moved successfully",
              oldPath,
              newPath,
              toast: {
                type: "success",
                message: `Item moved: ${oldPath} -> ${newPath}`,
              },
            });
          }
          return;
        }

        if (code !== 0) {
          fileLogger.error(
            `SSH moveItem command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
          );
          if (!res.headersSent) {
            return res.status(500).json({
              error: `Command failed: ${errorData}`,
              toast: { type: "error", message: `Move failed: ${errorData}` },
            });
          }
          return;
        }

        if (!res.headersSent) {
          res.json({
            message: "Item moved successfully",
            oldPath,
            newPath,
            toast: {
              type: "success",
              message: `Item moved: ${oldPath} -> ${newPath}`,
            },
          });
        }
      });

      stream.on("error", (streamErr) => {
        clearTimeout(commandTimeout);
        fileLogger.error("SSH moveItem stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  });
}
