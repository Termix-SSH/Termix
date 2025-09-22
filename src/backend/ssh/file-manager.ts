import express from "express";
import cors from "cors";
import { Client as SSHClient } from "ssh2";
import { getDb } from "../database/db/index.js";
import { sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { fileLogger } from "../utils/logger.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";

// Executable file detection utility function
function isExecutableFile(permissions: string, fileName: string): boolean {
  // Check execute permission bits (user, group, other)
  const hasExecutePermission =
    permissions[3] === "x" || permissions[6] === "x" || permissions[9] === "x";

  // Common script file extensions
  const scriptExtensions = [
    ".sh",
    ".py",
    ".pl",
    ".rb",
    ".js",
    ".php",
    ".bash",
    ".zsh",
    ".fish",
  ];
  const hasScriptExtension = scriptExtensions.some((ext) =>
    fileName.toLowerCase().endsWith(ext),
  );

  // Common compiled executable files (no extension or specific extensions)
  const executableExtensions = [".bin", ".exe", ".out"];
  const hasExecutableExtension = executableExtensions.some((ext) =>
    fileName.toLowerCase().endsWith(ext),
  );

  // Files with no extension and execute permission are usually executable files
  const hasNoExtension = !fileName.includes(".") && hasExecutePermission;

  return (
    hasExecutePermission &&
    (hasScriptExtension || hasExecutableExtension || hasNoExtension)
  );
}

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "User-Agent",
      "X-Electron-App",
    ],
  }),
);
app.use(express.json({ limit: "1gb" }));
app.use(express.urlencoded({ limit: "1gb", extended: true }));
app.use(express.raw({ limit: "5gb", type: "application/octet-stream" }));

interface SSHSession {
  client: SSHClient;
  isConnected: boolean;
  lastActive: number;
  timeout?: NodeJS.Timeout;
}

const sshSessions: Record<string, SSHSession> = {};

function cleanupSession(sessionId: string) {
  const session = sshSessions[sessionId];
  if (session) {
    try {
      session.client.end();
    } catch {}
    clearTimeout(session.timeout);
    delete sshSessions[sessionId];
  }
}

function scheduleSessionCleanup(sessionId: string) {
  const session = sshSessions[sessionId];
  if (session) {
    // Clear existing timeout
    if (session.timeout) clearTimeout(session.timeout);

    // Set new timeout for 10 minutes of inactivity
    session.timeout = setTimeout(() => {
      fileLogger.info(`Cleaning up inactive SSH session: ${sessionId}`);
      cleanupSession(sessionId);
    }, 10 * 60 * 1000); // 10 minutes
  }
}

app.post("/ssh/file_manager/ssh/connect", async (req, res) => {
  const {
    sessionId,
    hostId,
    ip,
    port,
    username,
    password,
    sshKey,
    keyPassword,
    authType,
    credentialId,
    userId,
  } = req.body;

  if (!sessionId || !ip || !username || !port) {
    fileLogger.warn("Missing SSH connection parameters for file manager", {
      operation: "file_connect",
      sessionId,
      hasIp: !!ip,
      hasUsername: !!username,
      hasPort: !!port,
    });
    return res.status(400).json({ error: "Missing SSH connection parameters" });
  }

  if (sshSessions[sessionId]?.isConnected) {
    cleanupSession(sessionId);
  }
  const client = new SSHClient();

  let resolvedCredentials = { password, sshKey, keyPassword, authType };
  if (credentialId && hostId && userId) {
    try {
      const credentials = await SimpleDBOps.select(
        getDb()
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, credentialId),
              eq(sshCredentials.userId, userId),
            ),
          ),
        "ssh_credentials",
        userId,
      );

      if (credentials.length > 0) {
        const credential = credentials[0];
        resolvedCredentials = {
          password: credential.password,
          sshKey: credential.privateKey || credential.key, // prefer new privateKey field
          keyPassword: credential.keyPassword,
          authType: credential.authType,
        };
      } else {
        fileLogger.warn(`No credentials found for host ${hostId}`, {
          operation: "ssh_credentials",
          hostId,
          credentialId,
          userId,
        });
      }
    } catch (error) {
      fileLogger.warn(`Failed to resolve credentials for host ${hostId}`, {
        operation: "ssh_credentials",
        hostId,
        credentialId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } else if (credentialId && hostId) {
    fileLogger.warn(
      "Missing userId for credential resolution in file manager",
      {
        operation: "ssh_credentials",
        hostId,
        credentialId,
        hasUserId: !!userId,
      },
    );
  }

  const config: any = {
    host: ip,
    port: port || 22,
    username,
    readyTimeout: 60000,
    keepaliveInterval: 30000,
    keepaliveCountMax: 3,
    algorithms: {
      kex: [
        "diffie-hellman-group14-sha256",
        "diffie-hellman-group14-sha1",
        "diffie-hellman-group1-sha1",
        "diffie-hellman-group-exchange-sha256",
        "diffie-hellman-group-exchange-sha1",
        "ecdh-sha2-nistp256",
        "ecdh-sha2-nistp384",
        "ecdh-sha2-nistp521",
      ],
      cipher: [
        "aes128-ctr",
        "aes192-ctr",
        "aes256-ctr",
        "aes128-gcm@openssh.com",
        "aes256-gcm@openssh.com",
        "aes128-cbc",
        "aes192-cbc",
        "aes256-cbc",
        "3des-cbc",
      ],
      hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1", "hmac-md5"],
      compress: ["none", "zlib@openssh.com", "zlib"],
    },
  };

  if (resolvedCredentials.sshKey && resolvedCredentials.sshKey.trim()) {
    try {
      if (
        !resolvedCredentials.sshKey.includes("-----BEGIN") ||
        !resolvedCredentials.sshKey.includes("-----END")
      ) {
        throw new Error("Invalid private key format");
      }

      const cleanKey = resolvedCredentials.sshKey
        .trim()
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

      config.privateKey = Buffer.from(cleanKey, "utf8");

      if (resolvedCredentials.keyPassword)
        config.passphrase = resolvedCredentials.keyPassword;
    } catch (keyError) {
      fileLogger.error("SSH key format error for file manager", {
        operation: "file_connect",
        sessionId,
        hostId,
        error: keyError.message,
      });
      return res.status(400).json({ error: "Invalid SSH key format" });
    }
  } else if (
    resolvedCredentials.password &&
    resolvedCredentials.password.trim()
  ) {
    config.password = resolvedCredentials.password;
  } else {
    fileLogger.warn("No authentication method provided for file manager", {
      operation: "file_connect",
      sessionId,
      hostId,
    });
    return res
      .status(400)
      .json({ error: "Either password or SSH key must be provided" });
  }

  let responseSent = false;

  client.on("ready", () => {
    if (responseSent) return;
    responseSent = true;
    sshSessions[sessionId] = {
      client,
      isConnected: true,
      lastActive: Date.now(),
    };
    scheduleSessionCleanup(sessionId);
    res.json({ status: "success", message: "SSH connection established" });
  });

  client.on("error", (err) => {
    if (responseSent) return;
    responseSent = true;
    fileLogger.error("SSH connection failed for file manager", {
      operation: "file_connect",
      sessionId,
      hostId,
      ip,
      port,
      username,
      error: err.message,
    });
    res.status(500).json({ status: "error", message: err.message });
  });

  client.on("close", () => {
    if (sshSessions[sessionId]) sshSessions[sessionId].isConnected = false;
    cleanupSession(sessionId);
  });

  client.connect(config);
});

app.post("/ssh/file_manager/ssh/disconnect", (req, res) => {
  const { sessionId } = req.body;
  cleanupSession(sessionId);
  res.json({ status: "success", message: "SSH connection disconnected" });
});

app.get("/ssh/file_manager/ssh/status", (req, res) => {
  const sessionId = req.query.sessionId as string;
  const isConnected = !!sshSessions[sessionId]?.isConnected;
  res.json({ status: "success", connected: isConnected });
});

app.get("/ssh/file_manager/ssh/listFiles", (req, res) => {
  const sessionId = req.query.sessionId as string;
  const sshConn = sshSessions[sessionId];
  const sshPath = decodeURIComponent((req.query.path as string) || "/");

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  sshConn.lastActive = Date.now();

  const escapedPath = sshPath.replace(/'/g, "'\"'\"'");
  sshConn.client.exec(`ls -la '${escapedPath}'`, (err, stream) => {
    if (err) {
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
        fileLogger.error(
          `SSH listFiles command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
        );
        return res.status(500).json({ error: `Command failed: ${errorData}` });
      }

      const lines = data.split("\n").filter((line) => line.trim());
      const files = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          const permissions = parts[0];
          const linkCount = parts[1];
          const owner = parts[2];
          const group = parts[3];
          const size = parseInt(parts[4], 10);

          // Date may occupy 3 parts (month day time) or (month day year)
          let dateStr = "";
          let nameStartIndex = 8;

          if (parts[5] && parts[6] && parts[7]) {
            // Regular format: month day time/year
            dateStr = `${parts[5]} ${parts[6]} ${parts[7]}`;
          }

          const name = parts.slice(nameStartIndex).join(" ");
          const isDirectory = permissions.startsWith("d");
          const isLink = permissions.startsWith("l");

          if (name === "." || name === "..") continue;

          // Parse symbolic link target
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
            size: isDirectory ? undefined : size, // Directories don't show size
            modified: dateStr,
            permissions,
            owner,
            group,
            linkTarget, // Symbolic link target
            path: `${sshPath.endsWith("/") ? sshPath : sshPath + "/"}${actualName}`, // Add full path
            executable:
              !isDirectory && !isLink
                ? isExecutableFile(permissions, actualName)
                : false, // Detect executable files
          });
        }
      }

      res.json({ files, path: sshPath });
    });
  });
});

app.get("/ssh/file_manager/ssh/identifySymlink", (req, res) => {
  const sessionId = req.query.sessionId as string;
  const sshConn = sshSessions[sessionId];
  const linkPath = decodeURIComponent(req.query.path as string);

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!linkPath) {
    return res.status(400).json({ error: "Link path is required" });
  }

  sshConn.lastActive = Date.now();

  const escapedPath = linkPath.replace(/'/g, "'\"'\"'");
  const command = `stat -L -c "%F" '${escapedPath}' && readlink -f '${escapedPath}'`;

  sshConn.client.exec(command, (err, stream) => {
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
        return res.status(500).json({ error: `Command failed: ${errorData}` });
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

app.get("/ssh/file_manager/ssh/readFile", (req, res) => {
  const sessionId = req.query.sessionId as string;
  const sshConn = sshSessions[sessionId];
  const filePath = decodeURIComponent(req.query.path as string);

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!filePath) {
    return res.status(400).json({ error: "File path is required" });
  }

  sshConn.lastActive = Date.now();

  // Support large file reading - increased limit for better compatibility
  const MAX_READ_SIZE = 500 * 1024 * 1024; // 500MB - much more reasonable limit
  const escapedPath = filePath.replace(/'/g, "'\"'\"'");

  // Get file size first
  sshConn.client.exec(
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
          fileLogger.error(`File size check failed: ${sizeErrorData}`);
          return res
            .status(500)
            .json({ error: `Cannot check file size: ${sizeErrorData}` });
        }

        const fileSize = parseInt(sizeData.trim(), 10);

        if (isNaN(fileSize)) {
          fileLogger.error("Invalid file size response:", sizeData);
          return res.status(500).json({ error: "Cannot determine file size" });
        }

        // Check if file is too large
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

        // File size is acceptable, proceed with reading
        sshConn.client.exec(`cat '${escapedPath}'`, (err, stream) => {
          if (err) {
            fileLogger.error("SSH readFile error:", err);
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
                `SSH readFile command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
              );
              return res
                .status(500)
                .json({ error: `Command failed: ${errorData}` });
            }

            res.json({ content: data, path: filePath });
          });
        });
      });
    },
  );
});

app.post("/ssh/file_manager/ssh/writeFile", async (req, res) => {
  const { sessionId, path: filePath, content, hostId, userId } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!filePath) {
    return res.status(400).json({ error: "File path is required" });
  }

  if (content === undefined) {
    return res.status(400).json({ error: "File content is required" });
  }

  sshConn.lastActive = Date.now();

  const trySFTP = () => {
    try {
      sshConn.client.sftp((err, sftp) => {
        if (err) {
          fileLogger.warn(
            `SFTP failed, trying fallback method: ${err.message}`,
          );
          tryFallbackMethod();
          return;
        }

        let fileBuffer;
        try {
          if (typeof content === "string") {
            fileBuffer = Buffer.from(content, "utf8");
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

        const writeStream = sftp.createWriteStream(filePath);

        let hasError = false;
        let hasFinished = false;

        writeStream.on("error", (streamErr) => {
          if (hasError || hasFinished) return;
          hasError = true;
          fileLogger.warn(
            `SFTP write failed, trying fallback method: ${streamErr.message}`,
          );
          tryFallbackMethod();
        });

        writeStream.on("finish", () => {
          if (hasError || hasFinished) return;
          hasFinished = true;
          if (!res.headersSent) {
            res.json({
              message: "File written successfully",
              path: filePath,
              toast: { type: "success", message: `File written: ${filePath}` },
            });
          }
        });

        writeStream.on("close", () => {
          if (hasError || hasFinished) return;
          hasFinished = true;
          if (!res.headersSent) {
            res.json({
              message: "File written successfully",
              path: filePath,
              toast: { type: "success", message: `File written: ${filePath}` },
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
            `SFTP write operation failed, trying fallback method: ${writeErr.message}`,
          );
          tryFallbackMethod();
        }
      });
    } catch (sftpErr) {
      fileLogger.warn(
        `SFTP connection error, trying fallback method: ${sftpErr.message}`,
      );
      tryFallbackMethod();
    }
  };

  const tryFallbackMethod = () => {
    try {
      const base64Content = Buffer.from(content, "utf8").toString("base64");
      const escapedPath = filePath.replace(/'/g, "'\"'\"'");

      const writeCommand = `echo '${base64Content}' | base64 -d > '${escapedPath}' && echo "SUCCESS"`;

      sshConn.client.exec(writeCommand, (err, stream) => {
        if (err) {
          fileLogger.error("Fallback write command failed:", err);
          if (!res.headersSent) {
            return res.status(500).json({
              error: `Write failed: ${err.message}`,
              toast: { type: "error", message: `Write failed: ${err.message}` },
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

        stream.on("close", (code) => {
          if (outputData.includes("SUCCESS")) {
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
          } else {
            fileLogger.error(
              `Fallback write failed with code ${code}: ${errorData}`,
            );
            if (!res.headersSent) {
              res.status(500).json({
                error: `Write failed: ${errorData}`,
                toast: { type: "error", message: `Write failed: ${errorData}` },
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
        res
          .status(500)
          .json({ error: `All write methods failed: ${fallbackErr.message}` });
      }
    }
  };

  trySFTP();
});

app.post("/ssh/file_manager/ssh/uploadFile", async (req, res) => {
  const {
    sessionId,
    path: filePath,
    content,
    fileName,
    hostId,
    userId,
  } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!filePath || !fileName || content === undefined) {
    return res
      .status(400)
      .json({ error: "File path, name, and content are required" });
  }

  sshConn.lastActive = Date.now();

  const fullPath = filePath.endsWith("/")
    ? filePath + fileName
    : filePath + "/" + fileName;

  const trySFTP = () => {
    try {
      sshConn.client.sftp((err, sftp) => {
        if (err) {
          fileLogger.warn(
            `SFTP failed, trying fallback method: ${err.message}`,
          );
          tryFallbackMethod();
          return;
        }

        let fileBuffer;
        try {
          if (typeof content === "string") {
            fileBuffer = Buffer.from(content, "utf8");
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
          );
          tryFallbackMethod();
        });

        writeStream.on("finish", () => {
          if (hasError || hasFinished) return;
          hasFinished = true;
          if (!res.headersSent) {
            res.json({
              message: "File uploaded successfully",
              path: fullPath,
              toast: { type: "success", message: `File uploaded: ${fullPath}` },
            });
          }
        });

        writeStream.on("close", () => {
          if (hasError || hasFinished) return;
          hasFinished = true;
          if (!res.headersSent) {
            res.json({
              message: "File uploaded successfully",
              path: fullPath,
              toast: { type: "success", message: `File uploaded: ${fullPath}` },
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
            `SFTP write operation failed, trying fallback method: ${writeErr.message}`,
          );
          tryFallbackMethod();
        }
      });
    } catch (sftpErr) {
      fileLogger.warn(
        `SFTP connection error, trying fallback method: ${sftpErr.message}`,
      );
      tryFallbackMethod();
    }
  };

  const tryFallbackMethod = () => {
    try {
      const base64Content = Buffer.from(content, "utf8").toString("base64");
      const chunkSize = 1000000;
      const chunks = [];

      for (let i = 0; i < base64Content.length; i += chunkSize) {
        chunks.push(base64Content.slice(i, i + chunkSize));
      }

      if (chunks.length === 1) {
        const tempFile = `/tmp/upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const escapedTempFile = tempFile.replace(/'/g, "'\"'\"'");
        const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

        const writeCommand = `echo '${chunks[0]}' | base64 -d > '${escapedPath}' && echo "SUCCESS"`;

        sshConn.client.exec(writeCommand, (err, stream) => {
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
        const tempFile = `/tmp/upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const escapedTempFile = tempFile.replace(/'/g, "'\"'\"'");
        const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

        let writeCommand = `> '${escapedPath}'`;

        chunks.forEach((chunk, index) => {
          writeCommand += ` && echo '${chunk}' | base64 -d >> '${escapedPath}'`;
        });

        writeCommand += ` && echo "SUCCESS"`;

        sshConn.client.exec(writeCommand, (err, stream) => {
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
        res
          .status(500)
          .json({ error: `All upload methods failed: ${fallbackErr.message}` });
      }
    }
  };

  trySFTP();
});

app.post("/ssh/file_manager/ssh/createFile", async (req, res) => {
  const {
    sessionId,
    path: filePath,
    fileName,
    content = "",
    hostId,
    userId,
  } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
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

  sshConn.client.exec(createCommand, (err, stream) => {
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

app.post("/ssh/file_manager/ssh/createFolder", async (req, res) => {
  const { sessionId, path: folderPath, folderName, hostId, userId } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!folderPath || !folderName) {
    return res.status(400).json({ error: "Folder path and name are required" });
  }

  sshConn.lastActive = Date.now();

  const fullPath = folderPath.endsWith("/")
    ? folderPath + folderName
    : folderPath + "/" + folderName;
  const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

  const createCommand = `mkdir -p '${escapedPath}' && echo "SUCCESS" && exit 0`;

  sshConn.client.exec(createCommand, (err, stream) => {
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
        if (!res.headersSent) {
          res.json({
            message: "Folder created successfully",
            path: fullPath,
            toast: { type: "success", message: `Folder created: ${fullPath}` },
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

app.delete("/ssh/file_manager/ssh/deleteItem", async (req, res) => {
  const { sessionId, path: itemPath, isDirectory, hostId, userId } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!itemPath) {
    return res.status(400).json({ error: "Item path is required" });
  }

  sshConn.lastActive = Date.now();
  const escapedPath = itemPath.replace(/'/g, "'\"'\"'");

  const deleteCommand = isDirectory
    ? `rm -rf '${escapedPath}' && echo "SUCCESS" && exit 0`
    : `rm -f '${escapedPath}' && echo "SUCCESS" && exit 0`;

  sshConn.client.exec(deleteCommand, (err, stream) => {
    if (err) {
      fileLogger.error("SSH deleteItem error:", err);
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
        fileLogger.error(`Permission denied deleting: ${itemPath}`);
        if (!res.headersSent) {
          return res.status(403).json({
            error: `Permission denied: Cannot delete ${itemPath}. Check file permissions.`,
          });
        }
        return;
      }
    });

    stream.on("close", (code) => {
      if (outputData.includes("SUCCESS")) {
        if (!res.headersSent) {
          res.json({
            message: "Item deleted successfully",
            path: itemPath,
            toast: {
              type: "success",
              message: `${isDirectory ? "Directory" : "File"} deleted: ${itemPath}`,
            },
          });
        }
        return;
      }

      if (code !== 0) {
        fileLogger.error(
          `SSH deleteItem command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
        );
        if (!res.headersSent) {
          return res.status(500).json({
            error: `Command failed: ${errorData}`,
            toast: { type: "error", message: `Delete failed: ${errorData}` },
          });
        }
        return;
      }

      if (!res.headersSent) {
        res.json({
          message: "Item deleted successfully",
          path: itemPath,
          toast: {
            type: "success",
            message: `${isDirectory ? "Directory" : "File"} deleted: ${itemPath}`,
          },
        });
      }
    });

    stream.on("error", (streamErr) => {
      fileLogger.error("SSH deleteItem stream error:", streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: `Stream error: ${streamErr.message}` });
      }
    });
  });
});

app.put("/ssh/file_manager/ssh/renameItem", async (req, res) => {
  const { sessionId, oldPath, newName, hostId, userId } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!oldPath || !newName) {
    return res
      .status(400)
      .json({ error: "Old path and new name are required" });
  }

  sshConn.lastActive = Date.now();

  const oldDir = oldPath.substring(0, oldPath.lastIndexOf("/") + 1);
  const newPath = oldDir + newName;
  const escapedOldPath = oldPath.replace(/'/g, "'\"'\"'");
  const escapedNewPath = newPath.replace(/'/g, "'\"'\"'");

  const renameCommand = `mv '${escapedOldPath}' '${escapedNewPath}' && echo "SUCCESS" && exit 0`;

  sshConn.client.exec(renameCommand, (err, stream) => {
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

// New API for moving files/folders across directories (for cut operation)
app.put("/ssh/file_manager/ssh/moveItem", async (req, res) => {
  const { sessionId, oldPath, newPath, hostId, userId } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
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

  sshConn.client.exec(moveCommand, (err, stream) => {
    if (err) {
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
      fileLogger.error("SSH moveItem stream error:", streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: `Stream error: ${streamErr.message}` });
      }
    });
  });
});

app.post("/ssh/file_manager/ssh/downloadFile", async (req, res) => {
  const { sessionId, path: filePath, hostId, userId } = req.body;

  if (!sessionId || !filePath) {
    fileLogger.warn("Missing download parameters", {
      operation: "file_download",
      sessionId,
      hasFilePath: !!filePath,
    });
    return res.status(400).json({ error: "Missing download parameters" });
  }

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

  sshConn.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);

  // Use SFTP to read file for binary safety
  sshConn.client.sftp((err, sftp) => {
    if (err) {
      fileLogger.error("SFTP connection failed for download:", err);
      return res.status(500).json({ error: "SFTP connection failed" });
    }

    // Get file stats first to check if it's a regular file and get size
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

      // Support large file downloads - increased limit for better compatibility
      const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB - reasonable for SSH file operations
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

      // Read file content
      sftp.readFile(filePath, (readErr, data) => {
        if (readErr) {
          fileLogger.error("File read failed for download:", readErr);
          return res
            .status(500)
            .json({ error: `Failed to read file: ${readErr.message}` });
        }

        // Convert to base64 for safe transport
        const base64Content = data.toString("base64");
        const fileName = filePath.split("/").pop() || "download";

        fileLogger.success("File downloaded successfully", {
          operation: "file_download",
          sessionId,
          filePath,
          fileName,
          fileSize: stats.size,
          hostId,
          userId,
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
  });
});

// Copy SSH file/directory
app.post("/ssh/file_manager/ssh/copyItem", async (req, res) => {
  const { sessionId, sourcePath, targetDir, hostId, userId } = req.body;

  if (!sessionId || !sourcePath || !targetDir) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const sshConn = sshSessions[sessionId];
  if (!sshConn || !sshConn.isConnected) {
    return res
      .status(400)
      .json({ error: "SSH session not found or not connected" });
  }

  sshConn.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);

  try {
    // Extract source name
    const sourceName = sourcePath.split("/").pop() || "copied_item";

    // First check if source file exists
    const escapedSourceForCheck = sourcePath.replace(/'/g, "'\"'\"'");
    const checkExistsCommand = `test -e '${escapedSourceForCheck}'`;
    const checkExists = await new Promise<boolean>((resolve) => {
      sshConn.client.exec(checkExistsCommand, (err, stream) => {
        if (err) {
          fileLogger.error("File existence check error:", err);
          resolve(false);
          return;
        }

        stream.on("close", (code) => {
          fileLogger.info("File existence check completed", {
            sourcePath,
            exists: code === 0,
          });
          resolve(code === 0);
        });

        stream.on("error", () => resolve(false));
      });
    });

    if (!checkExists) {
      return res.status(404).json({
        error: `Source file not found: ${sourcePath}`,
        toast: {
          type: "error",
          message: `Source file not found: ${sourceName}`,
        },
      });
    }

    // Use timestamp for uniqueness
    const timestamp = Date.now().toString().slice(-8);
    const nameWithoutExt = sourceName.includes(".")
      ? sourceName.substring(0, sourceName.lastIndexOf("."))
      : sourceName;
    const extension = sourceName.includes(".")
      ? sourceName.substring(sourceName.lastIndexOf("."))
      : "";

    // Always use timestamp suffix to ensure uniqueness without SSH calls
    const uniqueName = `${nameWithoutExt}_copy_${timestamp}${extension}`;

    fileLogger.info("Using timestamp-based unique name", {
      originalName: sourceName,
      uniqueName,
    });
    const targetPath = `${targetDir}/${uniqueName}`;

    // Escape paths for shell commands
    const escapedSource = sourcePath.replace(/'/g, "'\"'\"'");
    const escapedTarget = targetPath.replace(/'/g, "'\"'\"'");

    // Use cp with explicit flags to avoid hanging on prompts
    // -f: force overwrite without prompting
    // -r: recursive for directories
    // -p: preserve timestamps, permissions
    const copyCommand = `cp -fpr '${escapedSource}' '${escapedTarget}' 2>&1`;

    fileLogger.info("Starting file copy operation", {
      operation: "file_copy_start",
      sessionId,
      sourcePath,
      targetPath,
      uniqueName,
      command: copyCommand.substring(0, 200) + "...", // Log truncated command
    });

    // Add timeout to prevent hanging
    const commandTimeout = setTimeout(() => {
      fileLogger.error("Copy command timed out after 20 seconds", {
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
    }, 20000); // 20 second timeout for better responsiveness

    sshConn.client.exec(copyCommand, (err, stream) => {
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

      // Monitor both stdout and stderr
      stream.on("data", (data: Buffer) => {
        const output = data.toString();
        stdoutData += output;
        fileLogger.info("Copy command stdout", {
          output: output.substring(0, 200),
        });
      });

      stream.stderr.on("data", (data: Buffer) => {
        const output = data.toString();
        errorData += output;
        fileLogger.info("Copy command stderr", {
          output: output.substring(0, 200),
        });
      });

      stream.on("close", (code) => {
        clearTimeout(commandTimeout);
        fileLogger.info("Copy command completed", {
          code,
          errorData,
          hasError: errorData.length > 0,
        });

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
      });

      stream.on("error", (streamErr) => {
        clearTimeout(commandTimeout);
        fileLogger.error("SSH copyItem stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  } catch (error: any) {
    fileLogger.error("Copy operation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to determine MIME type based on file extension
function getMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    txt: "text/plain",
    json: "application/json",
    js: "text/javascript",
    html: "text/html",
    css: "text/css",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    pdf: "application/pdf",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

process.on("SIGINT", () => {
  Object.keys(sshSessions).forEach(cleanupSession);
  process.exit(0);
});

process.on("SIGTERM", () => {
  Object.keys(sshSessions).forEach(cleanupSession);
  process.exit(0);
});

// Execute executable file
app.post("/ssh/file_manager/ssh/executeFile", async (req, res) => {
  const { sessionId, filePath, hostId, userId } = req.body;
  const sshConn = sshSessions[sessionId];

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

  if (!filePath) {
    return res.status(400).json({ error: "File path is required" });
  }

  const escapedPath = filePath.replace(/'/g, "'\"'\"'");

  // Check if file exists and is executable
  const checkCommand = `test -x '${escapedPath}' && echo "EXECUTABLE" || echo "NOT_EXECUTABLE"`;

  sshConn.client.exec(checkCommand, (checkErr, checkStream) => {
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

    checkStream.on("close", (code) => {
      if (!checkResult.includes("EXECUTABLE")) {
        return res.status(400).json({ error: "File is not executable" });
      }

      // Execute file
      const executeCommand = `cd "$(dirname '${escapedPath}')" && '${escapedPath}' 2>&1; echo "EXIT_CODE:$?"`;

      fileLogger.info("Executing file", {
        operation: "execute_file",
        sessionId,
        filePath,
        command: executeCommand.substring(0, 100) + "...",
      });

      sshConn.client.exec(executeCommand, (err, stream) => {
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
          // Extract exit code from output
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

const PORT = 8084;
app.listen(PORT, () => {
  fileLogger.success("File Manager API server started", {
    operation: "server_start",
    port: PORT,
  });
});
