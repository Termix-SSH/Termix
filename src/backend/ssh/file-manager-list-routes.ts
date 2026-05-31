import type { Express } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { fileLogger } from "../utils/logger.js";
import {
  execChannel,
  getSessionSftp,
  type SSHSession,
} from "./file-manager-session.js";
import {
  formatMtime,
  isExecutableFile,
  modeToPermissions,
} from "./file-manager-utils.js";

type FileListingRoutesDeps = {
  sshSessions: Record<string, SSHSession>;
  activeListRequests: Record<string, boolean>;
  verifySessionOwnership: (session: SSHSession, userId: string) => boolean;
};

export function registerFileListingRoutes(
  app: Express,
  {
    sshSessions,
    activeListRequests,
    verifySessionOwnership,
  }: FileListingRoutesDeps,
): void {
  /**
   * @openapi
   * /ssh/file_manager/ssh/listFiles:
   *   get:
   *     summary: List files in a directory
   *     description: Lists the files and directories in a given path on the remote host.
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
   *         description: A list of files and directories.
   *       400:
   *         description: Session ID is required or SSH connection not established.
   *       500:
   *         description: Failed to list files.
   */
  app.get("/ssh/file_manager/ssh/listFiles", (req, res) => {
    const sessionId = req.query.sessionId as string;
    const sshConn = sshSessions[sessionId];
    const sshPath = decodeURIComponent((req.query.path as string) || "/");
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

    // Drop concurrent requests for the same session+path — each would open
    // a new SSH channel and can exceed the server's per-connection channel limit.
    const listKey = `${sessionId}:${sshPath}`;
    if (activeListRequests[listKey]) {
      return res
        .status(409)
        .json({ error: "List request already in progress" });
    }
    activeListRequests[listKey] = true;
    res.on("finish", () => {
      delete activeListRequests[listKey];
    });

    sshConn.lastActive = Date.now();
    sshConn.activeOperations++;
    const trySFTP = () => {
      try {
        fileLogger.info("Opening SFTP channel", {
          operation: "file_sftp_open",
          sessionId,
          userId,
          path: sshPath,
        });
        getSessionSftp(sshConn)
          .then((sftp) => {
            sftp.readdir(sshPath, (readdirErr, list) => {
              if (readdirErr) {
                fileLogger.warn(
                  `SFTP readdir failed, trying fallback: ${readdirErr.message}`,
                );
                tryFallbackMethod();
                return;
              }

              const symlinks: Array<{ index: number; path: string }> = [];
              const files: Array<{
                name: string;
                type: string;
                size: number | undefined;
                modified: string;
                permissions: string;
                owner: string;
                group: string;
                linkTarget: string | undefined;
                path: string;
                executable: boolean;
              }> = [];

              for (const entry of list) {
                if (entry.filename === "." || entry.filename === "..") continue;

                const attrs = entry.attrs;
                const permissions = modeToPermissions(attrs.mode);
                const isDirectory = attrs.isDirectory();
                const isLink = attrs.isSymbolicLink();

                const fileEntry = {
                  name: entry.filename,
                  type: isDirectory ? "directory" : isLink ? "link" : "file",
                  size: isDirectory ? undefined : attrs.size,
                  modified: formatMtime(attrs.mtime),
                  permissions,
                  owner: String(attrs.uid),
                  group: String(attrs.gid),
                  linkTarget: undefined as string | undefined,
                  path: `${sshPath.endsWith("/") ? sshPath : sshPath + "/"}${entry.filename}`,
                  executable:
                    !isDirectory && !isLink
                      ? isExecutableFile(permissions, entry.filename)
                      : false,
                };

                if (isLink) {
                  symlinks.push({ index: files.length, path: fileEntry.path });
                }

                files.push(fileEntry);
              }

              if (symlinks.length === 0) {
                sshConn.activeOperations--;
                return res.json({ files, path: sshPath });
              }

              let resolved = 0;
              let responded = false;

              const sendResponse = () => {
                if (responded) return;
                responded = true;
                sshConn.activeOperations--;
                res.json({ files, path: sshPath });
              };

              const readlinkTimeout = setTimeout(sendResponse, 5000);

              for (const link of symlinks) {
                sftp.readlink(link.path, (linkErr, target) => {
                  resolved++;
                  if (!linkErr && target) {
                    files[link.index].linkTarget = target;
                  }
                  if (resolved === symlinks.length) {
                    clearTimeout(readlinkTimeout);
                    sendResponse();
                  }
                });
              }
            });
          })
          .catch((err: Error) => {
            fileLogger.warn(
              `SFTP failed for listFiles, trying fallback: ${err.message}`,
            );
            const isChannelFailure =
              err.message.toLowerCase().includes("channel open failure") ||
              err.message.toLowerCase().includes("open failed");
            if (isChannelFailure) {
              sshConn.isConnected = false;
              sshConn.sftp = undefined;
            }
            tryFallbackMethod();
          });
      } catch (sftpErr: unknown) {
        const errMsg =
          sftpErr instanceof Error ? sftpErr.message : "Unknown error";
        fileLogger.warn(`SFTP connection error, trying fallback: ${errMsg}`);
        tryFallbackMethod();
      }
    };

    const tryFallbackMethod = () => {
      if (!sshConn?.isConnected) {
        sshConn.activeOperations--;
        return res
          .status(503)
          .json({ error: "SSH session disconnected", disconnected: true });
      }
      try {
        const escapedPath = sshPath.replace(/'/g, "'\"'\"'");
        execChannel(
          sshConn,
          `command ls -la --color=never '${escapedPath}'`,
          (err, stream) => {
            if (err) {
              sshConn.activeOperations--;
              fileLogger.error("SSH listFiles error:", err);
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
                const isPermissionDenied =
                  errorData.toLowerCase().includes("permission denied") ||
                  errorData.toLowerCase().includes("access denied");

                if (isPermissionDenied) {
                  if (sshConn.sudoPassword) {
                    fileLogger.info(
                      `Permission denied for listFiles, retrying with sudo: ${sshPath}`,
                    );
                    tryWithSudo();
                    return;
                  }

                  sshConn.activeOperations--;
                  fileLogger.warn(
                    `Permission denied for listFiles, sudo required: ${sshPath}`,
                  );
                  return res.status(403).json({
                    error: `Permission denied: Cannot access ${sshPath}`,
                    needsSudo: true,
                    path: sshPath,
                  });
                }

                sshConn.activeOperations--;
                fileLogger.error(
                  `SSH listFiles command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
                );
                return res
                  .status(500)
                  .json({ error: `Command failed: ${errorData}` });
              }
              sshConn.activeOperations--;

              const lines = data.split("\n").filter((line) => line.trim());
              const files = [];

              for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                const parts = line.split(/\s+/);
                if (parts.length >= 9) {
                  const permissions = parts[0];
                  const owner = parts[2];
                  const group = parts[3];
                  const size = parseInt(parts[4], 10);

                  let dateStr = "";
                  const nameStartIndex = 8;

                  if (parts[5] && parts[6] && parts[7]) {
                    dateStr = `${parts[5]} ${parts[6]} ${parts[7]}`;
                  }

                  const name = parts.slice(nameStartIndex).join(" ");
                  const isDirectory = permissions.startsWith("d");
                  const isLink = permissions.startsWith("l");

                  if (name === "." || name === "..") continue;

                  let actualName = name;
                  let linkTarget = undefined;
                  if (isLink && name.includes(" -> ")) {
                    const linkParts = name.split(" -> ");
                    actualName = linkParts[0];
                    linkTarget = linkParts[1];
                  }

                  files.push({
                    name: actualName,
                    type: isDirectory ? "directory" : isLink ? "link" : "file",
                    size: isDirectory ? undefined : size,
                    modified: dateStr,
                    permissions,
                    owner,
                    group,
                    linkTarget,
                    path: `${sshPath.endsWith("/") ? sshPath : sshPath + "/"}${actualName}`,
                    executable:
                      !isDirectory && !isLink
                        ? isExecutableFile(permissions, actualName)
                        : false,
                  });
                }
              }

              res.json({ files, path: sshPath });
            });
          },
        );
      } catch (execErr: unknown) {
        sshConn.activeOperations--;
        const errMsg =
          execErr instanceof Error ? execErr.message : "Unknown error";
        fileLogger.error(`Fallback listFiles exec failed: ${errMsg}`);
        if (!res.headersSent) {
          return res.status(500).json({ error: errMsg });
        }
      }
    };

    const tryWithSudo = () => {
      try {
        const escapedPath = sshPath.replace(/'/g, "'\"'\"'");
        const escapedPassword = sshConn.sudoPassword!.replace(/'/g, "'\"'\"'");
        const sudoCommand = `echo '${escapedPassword}' | sudo -S /bin/ls -la --color=never '${escapedPath}' 2>&1`;

        execChannel(sshConn, sudoCommand, (err, stream) => {
          if (err) {
            sshConn.activeOperations--;
            fileLogger.error("SSH sudo listFiles error:", err);
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
            sshConn.activeOperations--;

            data = data.replace(/\[sudo\] password for .+?:\s*/g, "");

            if (
              data.toLowerCase().includes("sorry, try again") ||
              data.toLowerCase().includes("incorrect password") ||
              errorData.toLowerCase().includes("sorry, try again")
            ) {
              sshConn.sudoPassword = undefined;
              return res.status(403).json({
                error: "Sudo authentication failed. Please try again.",
                needsSudo: true,
                sudoFailed: true,
                path: sshPath,
              });
            }

            if (code !== 0 && !data.trim()) {
              fileLogger.error(
                `SSH sudo listFiles failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
              );
              return res
                .status(500)
                .json({ error: `Sudo command failed: ${errorData || data}` });
            }

            const lines = data.split("\n").filter((line) => line.trim());
            const files: Array<{
              name: string;
              type: string;
              size: number | undefined;
              modified: string;
              permissions: string;
              owner: string;
              group: string;
              linkTarget: string | undefined;
              path: string;
              executable: boolean;
            }> = [];

            for (let i = 1; i < lines.length; i++) {
              const line = lines[i];
              const parts = line.split(/\s+/);
              if (parts.length >= 9) {
                const permissions = parts[0];
                const owner = parts[2];
                const group = parts[3];
                const size = parseInt(parts[4], 10);

                let dateStr = "";
                const nameStartIndex = 8;

                if (parts[5] && parts[6] && parts[7]) {
                  dateStr = `${parts[5]} ${parts[6]} ${parts[7]}`;
                }

                const name = parts.slice(nameStartIndex).join(" ");
                const isDirectory = permissions.startsWith("d");
                const isLink = permissions.startsWith("l");

                if (name === "." || name === "..") continue;

                let actualName = name;
                let linkTarget = undefined;
                if (isLink && name.includes(" -> ")) {
                  const linkParts = name.split(" -> ");
                  actualName = linkParts[0];
                  linkTarget = linkParts[1];
                }

                files.push({
                  name: actualName,
                  type: isDirectory ? "directory" : isLink ? "link" : "file",
                  size: isDirectory ? undefined : size,
                  modified: dateStr,
                  permissions,
                  owner,
                  group,
                  linkTarget,
                  path: `${sshPath.endsWith("/") ? sshPath : sshPath + "/"}${actualName}`,
                  executable:
                    !isDirectory && !isLink
                      ? isExecutableFile(permissions, actualName)
                      : false,
                });
              }
            }

            res.json({ files, path: sshPath });
          });
        });
      } catch (execErr: unknown) {
        sshConn.activeOperations--;
        const errMsg =
          execErr instanceof Error ? execErr.message : "Unknown error";
        fileLogger.error(`Sudo listFiles exec failed: ${errMsg}`);
        if (!res.headersSent) {
          return res.status(500).json({ error: errMsg });
        }
      }
    };

    trySFTP();
  });
}
