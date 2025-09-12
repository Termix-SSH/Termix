import express from "express";
import cors from "cors";
import { Client as SSHClient } from "ssh2";
import { db } from "../database/db/index.js";
import { sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { fileLogger } from "../utils/logger.js";

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(express.raw({ limit: "200mb", type: "application/octet-stream" }));

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
    if (session.timeout) clearTimeout(session.timeout);
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
      const credentials = await db
        .select()
        .from(sshCredentials)
        .where(
          and(
            eq(sshCredentials.id, credentialId),
            eq(sshCredentials.userId, userId),
          ),
        );

      if (credentials.length > 0) {
        const credential = credentials[0];
        resolvedCredentials = {
          password: credential.password,
          sshKey: credential.key,
          keyPassword: credential.keyPassword,
          authType: credential.authType,
        };
      } else {
        fileLogger.warn("No credentials found in database for file manager", {
          operation: "file_connect",
          sessionId,
          hostId,
          credentialId,
          userId,
        });
      }
    } catch (error) {
      fileLogger.warn(
        "Failed to resolve credentials from database for file manager",
        {
          operation: "file_connect",
          sessionId,
          hostId,
          credentialId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
    }
  } else if (credentialId && hostId) {
    fileLogger.warn(
      "Missing userId for credential resolution in file manager",
      {
        operation: "file_connect",
        sessionId,
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
    readyTimeout: 0,
    keepaliveInterval: 30000,
    keepaliveCountMax: 0,
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
          const name = parts.slice(8).join(" ");
          const isDirectory = permissions.startsWith("d");
          const isLink = permissions.startsWith("l");

          if (name === "." || name === "..") continue;

          files.push({
            name,
            type: isDirectory ? "directory" : isLink ? "link" : "file",
          });
        }
      }

      res.json(files);
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

  const escapedPath = filePath.replace(/'/g, "'\"'\"'");
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
        return res.status(500).json({ error: `Command failed: ${errorData}` });
      }

      res.json({ content: data, path: filePath });
    });
  });
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
              res
                .status(500)
                .json({
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

process.on("SIGINT", () => {
  Object.keys(sshSessions).forEach(cleanupSession);
  process.exit(0);
});

process.on("SIGTERM", () => {
  Object.keys(sshSessions).forEach(cleanupSession);
  process.exit(0);
});

const PORT = 8084;
app.listen(PORT, () => {
  fileLogger.success("File Manager API server started", {
    operation: "server_start",
    port: PORT,
  });
});
