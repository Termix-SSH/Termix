import type { Express, Request, Response } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  execChannel,
  execWithSudo,
  getSessionSftp,
  type SSHSession,
} from "./session.js";
import { ensureDirectoryTreeSftp } from "./transfer-sftp-dir.js";
import { buildDeleteCommand } from "./operation-commands.js";
import {
  emptyTrash,
  listTrash,
  moveToTrash,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
} from "./trash-service.js";
import { PermissionManager } from "../../../../src/backend/utils/permission-manager.js";

type FileOperationRoutesDeps = {
  ctx: PluginContext;
  sshSessions: Record<string, SSHSession>;
  verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
};

const TRASH_RETENTION_DAYS_KEY = "trashRetentionDays";

export function registerFileOperationRoutes(
  app: Express,
  { ctx, sshSessions, verifySessionOwnership }: FileOperationRoutesDeps,
): void {
  // NOTE: trash retention is an install-wide admin setting, not a per-host
  // access check, so it stays on PermissionManager.isAdmin rather than
  // ctx.hosts.checkAccess (see rule 5 scope: host resolution/access only).
  const permissionManager = PermissionManager.getInstance();
  const getTrashRetentionDays = async (): Promise<number> => {
    try {
      const value = Number(await ctx.settings.get(TRASH_RETENTION_DAYS_KEY));
      return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : 7;
    } catch {
      return 7;
    }
  };

  async function ownedSession(
    req: Request,
    res: Response,
  ): Promise<SSHSession | null> {
    const sessionId = String(req.body?.sessionId ?? req.query?.sessionId ?? "");
    const session = sshSessions[sessionId];
    if (!sessionId || !session?.isConnected) {
      res.status(400).json({ error: "SSH connection not established" });
      return null;
    }
    if (!verifySessionOwnership(session, ctx.currentActor()!)) {
      res.status(403).json({ error: "Session access denied" });
      return null;
    }
    session.lastActive = Date.now();
    return session;
  }

  app.get("/trash", async (req, res) => {
    const session = await ownedSession(req, res);
    if (!session) return;
    try {
      const retentionDays = await getTrashRetentionDays();
      res.json({
        items: await listTrash(await getSessionSftp(session), retentionDays),
        retentionDays,
        canManageRetention: await permissionManager.isAdmin(
          ctx.currentActor()!,
        ),
      });
    } catch (error) {
      ctx.log.error("Failed to list trash", error as Error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/trash/:id/restore", async (req, res) => {
    const session = await ownedSession(req, res);
    if (!session) return;
    try {
      res.json({
        item: await restoreTrashItem(
          await getSessionSftp(session),
          req.params.id,
        ),
      });
    } catch (error) {
      const message = (error as Error).message;
      res
        .status(message.includes("already exists") ? 409 : 500)
        .json({ error: message });
    }
  });

  app.delete("/trash/:id", async (req, res) => {
    const session = await ownedSession(req, res);
    if (!session) return;
    try {
      await permanentlyDeleteTrashItem(
        await getSessionSftp(session),
        req.params.id,
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/trash", async (req, res) => {
    const session = await ownedSession(req, res);
    if (!session) return;
    try {
      res.json({ deleted: await emptyTrash(await getSessionSftp(session)) });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.put("/trash-retention", async (req, res) => {
    const userId = ctx.currentActor()!;
    if (!(await permissionManager.isAdmin(userId))) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const retentionDays = Number(req.body?.retentionDays);
    if (
      !Number.isInteger(retentionDays) ||
      retentionDays < 1 ||
      retentionDays > 3650
    ) {
      return res
        .status(400)
        .json({ error: "Retention must be between 1 and 3650 days" });
    }
    await ctx.settings.set(TRASH_RETENTION_DAYS_KEY, String(retentionDays));
    return res.json({ retentionDays });
  });
  /**
   * @openapi
   * /plugin-api/file-manager/createFile:
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
  app.post("/createFile", async (req, res) => {
    const { sessionId, path: filePath, fileName } = req.body;
    const sshConn = sshSessions[sessionId];
    const userId = ctx.currentActor()!;

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
        ctx.log.error("SSH createFile error:", err);
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
          ctx.log.error(`Permission denied creating file: ${fullPath}`);
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
          ctx.log.error(
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
        ctx.log.error("SSH createFile stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  });

  /**
   * @openapi
   * /plugin-api/file-manager/createFolder:
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
  app.post("/createFolder", async (req, res) => {
    const { sessionId, path: folderPath, folderName } = req.body;
    const sshConn = sshSessions[sessionId];
    const userId = ctx.currentActor()!;

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
    ctx.log.info(`Creating directory: ${sessionId} (${fullPath})`);
    try {
      await ensureDirectoryTreeSftp(await getSessionSftp(sshConn), fullPath);
      res.json({
        message: "Folder created successfully",
        path: fullPath,
        toast: { type: "success", message: `Folder created: ${fullPath}` },
      });
    } catch (error) {
      ctx.log.error("SFTP createFolder failed", error as Error);
      const code = (error as { code?: string | number }).code;
      res.status(code === 3 || code === "EACCES" ? 403 : 500).json({
        error: (error as Error).message,
      });
    }
  });

  /**
   * @openapi
   * /plugin-api/file-manager/deleteItem:
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
  app.delete("/deleteItem", async (req, res) => {
    const { sessionId, path: itemPath, isDirectory, permanent } = req.body;
    const sshConn = sshSessions[sessionId];
    const userId = ctx.currentActor()!;

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

    ctx.log.info(
      `Deleting item: ${sessionId} (${itemPath}, type=${isDirectory ? "directory" : "file"})`,
    );
    sshConn.lastActive = Date.now();

    if (!permanent) {
      try {
        const sftp = await getSessionSftp(sshConn);
        const retentionDays = await getTrashRetentionDays();
        await listTrash(sftp, retentionDays);
        const item = await moveToTrash(sftp, itemPath);
        ctx.log.info(
          `Item moved to trash: ${sessionId} (${itemPath}, trashId=${item.id})`,
        );
        return res.json({
          message: "Item moved to trash",
          path: itemPath,
          trashItem: item,
        });
      } catch (error) {
        ctx.log.error(
          `Failed to move item to trash: ${sessionId} (${itemPath})`,
          error as Error,
        );
        return res.status(409).json({
          error: (error as Error).message,
          trashUnavailable: true,
        });
      }
    }

    const { command: deleteCommand, commandWithSuccess } = buildDeleteCommand(
      itemPath,
      Boolean(isDirectory),
    );

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

        execChannel(sshConn, commandWithSuccess, (err, stream) => {
          if (err) {
            ctx.log.error("SSH deleteItem error:", err);
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
              ctx.log.error(`Permission denied deleting: ${itemPath}`);
              res.status(403).json({
                error: `Permission denied: Cannot delete ${itemPath}.`,
                needsSudo: true,
              });
              resolve();
              return;
            }

            if (outputData.includes("SUCCESS")) {
              ctx.log.info(
                `Item deleted successfully: ${sessionId} (${itemPath})`,
              );
              res.json({
                message: "Item deleted successfully",
                path: itemPath,
                toast: {
                  type: "success",
                  message: `${isDirectory ? "Directory" : "File"} deleted: ${itemPath}`,
                },
              });
            } else {
              const detail =
                errorData.trim() ||
                outputData.trim() ||
                `command exited with code ${code} and produced no output (the remote shell may not support the delete command)`;
              ctx.log.error(
                `Delete failed for ${itemPath}: ${detail} (sessionId=${sessionId})`,
              );
              res.status(500).json({
                error: `Delete failed: ${detail}`,
              });
            }
            resolve();
          });

          stream.on("error", (streamErr) => {
            ctx.log.error("SSH deleteItem stream error:", streamErr);
            res
              .status(500)
              .json({ error: `Stream error: ${streamErr.message}` });
            resolve();
          });
        });
      });
    };

    await executeDelete(false);
  });

  /**
   * @openapi
   * /plugin-api/file-manager/renameItem:
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
  app.put("/renameItem", async (req, res) => {
    const { sessionId, oldPath, newName } = req.body;
    const sshConn = sshSessions[sessionId];
    const userId = ctx.currentActor()!;

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
    ctx.log.info(`Renaming item: ${sessionId} (${oldPath} -> ${newPath})`);
    const escapedOldPath = oldPath.replace(/'/g, "'\"'\"'");
    const escapedNewPath = newPath.replace(/'/g, "'\"'\"'");

    const renameCommand = `mv '${escapedOldPath}' '${escapedNewPath}' && echo "SUCCESS" && exit 0`;

    execChannel(sshConn, renameCommand, (err, stream) => {
      if (err) {
        ctx.log.error("SSH renameItem error:", err);
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
          ctx.log.error(`Permission denied renaming: ${oldPath}`);
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
          ctx.log.info(
            `Item renamed successfully: ${sessionId} (${oldPath} -> ${newPath})`,
          );
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
          ctx.log.error(
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

        ctx.log.info(
          `Item renamed successfully: ${sessionId} (${oldPath} -> ${newPath})`,
        );
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
        ctx.log.error("SSH renameItem stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  });

  /**
   * @openapi
   * /plugin-api/file-manager/moveItem:
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
  app.put("/moveItem", async (req, res) => {
    const { sessionId, oldPath, newPath } = req.body;
    const sshConn = sshSessions[sessionId];
    const userId = ctx.currentActor()!;

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
        ctx.log.error("SSH moveItem error:", err);
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
          ctx.log.error(`Permission denied moving: ${oldPath}`);
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
          ctx.log.error(
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
        ctx.log.error("SSH moveItem stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  });
}
