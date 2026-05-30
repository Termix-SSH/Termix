import type {
  AuthenticatedRequest,
  CredentialBackend,
} from "../../../types/index.js";
import type { Request, RequestHandler, Response, Router } from "express";
import { eq } from "drizzle-orm";
import ssh2Pkg from "ssh2";
import { db } from "../db/index.js";
import { hosts, sshCredentials } from "../db/schema.js";

const { Client } = ssh2Pkg;

async function deploySSHKeyToHost(
  hostConfig: Record<string, unknown>,
  credData: CredentialBackend,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const publicKey = credData.publicKey as string;
  return new Promise((resolve) => {
    const conn = new Client();

    const connectionTimeout = setTimeout(() => {
      conn.destroy();
      resolve({ success: false, error: "Connection timeout" });
    }, 120000);

    conn.on("ready", async () => {
      clearTimeout(connectionTimeout);

      try {
        await new Promise<void>((resolveCmd, rejectCmd) => {
          const cmdTimeout = setTimeout(() => {
            rejectCmd(new Error("mkdir command timeout"));
          }, 10000);

          conn.exec(
            "test -d ~/.ssh || mkdir -p ~/.ssh; chmod 700 ~/.ssh",
            (err, stream) => {
              if (err) {
                clearTimeout(cmdTimeout);
                return rejectCmd(err);
              }

              stream.on("close", (code) => {
                clearTimeout(cmdTimeout);
                if (code === 0) {
                  resolveCmd();
                } else {
                  rejectCmd(
                    new Error(`mkdir command failed with code ${code}`),
                  );
                }
              });

              stream.on("data", () => {
                // Ignore output
              });
            },
          );
        });

        const keyExists = await new Promise<boolean>(
          (resolveCheck, rejectCheck) => {
            const checkTimeout = setTimeout(() => {
              rejectCheck(new Error("Key check timeout"));
            }, 5000);

            let actualPublicKey = publicKey;
            try {
              const parsed = JSON.parse(publicKey);
              if (parsed.data) {
                actualPublicKey = parsed.data;
              }
            } catch {
              // Ignore parse errors
            }

            const keyParts = actualPublicKey.trim().split(" ");
            if (keyParts.length < 2) {
              clearTimeout(checkTimeout);
              return rejectCheck(
                new Error(
                  "Invalid public key format - must contain at least 2 parts",
                ),
              );
            }

            const keyPattern = keyParts[1];

            conn.exec(
              `if [ -f ~/.ssh/authorized_keys ]; then grep -F "${keyPattern}" ~/.ssh/authorized_keys >/dev/null 2>&1; echo $?; else echo 1; fi`,
              (err, stream) => {
                if (err) {
                  clearTimeout(checkTimeout);
                  return rejectCheck(err);
                }

                let output = "";
                stream.on("data", (data) => {
                  output += data.toString();
                });

                stream.on("close", () => {
                  clearTimeout(checkTimeout);
                  const exists = output.trim() === "0";
                  resolveCheck(exists);
                });
              },
            );
          },
        );

        if (keyExists) {
          conn.end();
          resolve({ success: true, message: "SSH key already deployed" });
          return;
        }

        await new Promise<void>((resolveAdd, rejectAdd) => {
          const addTimeout = setTimeout(() => {
            rejectAdd(new Error("Key add timeout"));
          }, 30000);

          let actualPublicKey = publicKey;
          try {
            const parsed = JSON.parse(publicKey);
            if (parsed.data) {
              actualPublicKey = parsed.data;
            }
          } catch {
            // Ignore parse errors
          }

          const escapedKey = actualPublicKey
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "'\\''");
          const escapedName = credData.name
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "'\\''");

          conn.exec(
            `printf '%s\n' '${escapedKey} ${escapedName}@Termix' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
            (err, stream) => {
              if (err) {
                clearTimeout(addTimeout);
                return rejectAdd(err);
              }

              stream.on("data", () => {
                // Consume output
              });

              stream.on("close", (code) => {
                clearTimeout(addTimeout);
                if (code === 0) {
                  resolveAdd();
                } else {
                  rejectAdd(
                    new Error(`Key deployment failed with code ${code}`),
                  );
                }
              });
            },
          );
        });

        const verifySuccess = await new Promise<boolean>(
          (resolveVerify, rejectVerify) => {
            const verifyTimeout = setTimeout(() => {
              rejectVerify(new Error("Key verification timeout"));
            }, 5000);

            let actualPublicKey = publicKey;
            try {
              const parsed = JSON.parse(publicKey);
              if (parsed.data) {
                actualPublicKey = parsed.data;
              }
            } catch {
              // Ignore parse errors
            }

            const keyParts = actualPublicKey.trim().split(" ");
            if (keyParts.length < 2) {
              clearTimeout(verifyTimeout);
              return rejectVerify(
                new Error(
                  "Invalid public key format - must contain at least 2 parts",
                ),
              );
            }

            const keyPattern = keyParts[1];
            conn.exec(
              `grep -F "${keyPattern}" ~/.ssh/authorized_keys >/dev/null 2>&1; echo $?`,
              (err, stream) => {
                if (err) {
                  clearTimeout(verifyTimeout);
                  return rejectVerify(err);
                }

                let output = "";
                stream.on("data", (data) => {
                  output += data.toString();
                });

                stream.on("close", () => {
                  clearTimeout(verifyTimeout);
                  const verified = output.trim() === "0";
                  resolveVerify(verified);
                });
              },
            );
          },
        );

        conn.end();

        if (verifySuccess) {
          resolve({ success: true, message: "SSH key deployed successfully" });
        } else {
          resolve({
            success: false,
            error: "Key deployment verification failed",
          });
        }
      } catch (error) {
        conn.end();
        resolve({
          success: false,
          error: error instanceof Error ? error.message : "Deployment failed",
        });
      }
    });

    conn.on("error", (err) => {
      clearTimeout(connectionTimeout);
      let errorMessage = err.message;

      if (
        err.message.includes("All configured authentication methods failed")
      ) {
        errorMessage =
          "Authentication failed. Please check your credentials and ensure the SSH service is running.";
      } else if (
        err.message.includes("ENOTFOUND") ||
        err.message.includes("ENOENT")
      ) {
        errorMessage = "Could not resolve hostname or connect to server.";
      } else if (err.message.includes("ECONNREFUSED")) {
        errorMessage =
          "Connection refused. The server may not be running or the port may be incorrect.";
      } else if (err.message.includes("ETIMEDOUT")) {
        errorMessage =
          "Connection timed out. Check your network connection and server availability.";
      } else if (
        err.message.includes("authentication failed") ||
        err.message.includes("Permission denied")
      ) {
        errorMessage =
          "Authentication failed. Please check your username and password/key.";
      }

      resolve({ success: false, error: errorMessage });
    });

    try {
      const connectionConfig: Record<string, unknown> = {
        host: hostConfig.ip,
        port: hostConfig.port || 22,
        username: hostConfig.username,
        readyTimeout: 60000,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
        tcpKeepAlive: true,
        tcpKeepAliveInitialDelay: 30000,
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
          hmac: [
            "hmac-sha2-256-etm@openssh.com",
            "hmac-sha2-512-etm@openssh.com",
            "hmac-sha2-256",
            "hmac-sha2-512",
            "hmac-sha1",
            "hmac-md5",
          ],
          compress: ["none", "zlib@openssh.com", "zlib"],
        },
      };

      if (hostConfig.authType === "password" && hostConfig.password) {
        connectionConfig.password = hostConfig.password;
      } else if (hostConfig.authType === "key" && hostConfig.privateKey) {
        try {
          const privateKey = hostConfig.privateKey as string;
          if (
            !privateKey.includes("-----BEGIN") ||
            !privateKey.includes("-----END")
          ) {
            throw new Error("Invalid private key format");
          }

          const cleanKey = privateKey
            .trim()
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");

          connectionConfig.privateKey = Buffer.from(cleanKey, "utf8");

          if (hostConfig.keyPassword) {
            connectionConfig.passphrase = hostConfig.keyPassword;
          }
        } catch (keyError) {
          clearTimeout(connectionTimeout);
          resolve({
            success: false,
            error: `Invalid SSH key format: ${keyError instanceof Error ? keyError.message : "Unknown error"}`,
          });
          return;
        }
      } else {
        clearTimeout(connectionTimeout);
        resolve({
          success: false,
          error: `Invalid authentication configuration. Auth type: ${hostConfig.authType}, has password: ${!!hostConfig.password}, has key: ${!!hostConfig.privateKey}`,
        });
        return;
      }

      conn.connect(connectionConfig);
    } catch (error) {
      clearTimeout(connectionTimeout);
      resolve({
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      });
    }
  });
}

export function registerCredentialDeployRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /credentials/{id}/deploy-to-host:
   *   post:
   *     summary: Deploy SSH key to a host
   *     description: Deploys an SSH public key to a target host's authorized_keys file.
   *     tags:
   *       - Credentials
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               targetHostId:
   *                 type: integer
   *     responses:
   *       200:
   *         description: SSH key deployed successfully.
   *       400:
   *         description: Credential ID and target host ID are required.
   *       401:
   *         description: Authentication required.
   *       404:
   *         description: Credential or target host not found.
   *       500:
   *         description: Failed to deploy SSH key.
   */
  router.post(
    "/:id/deploy-to-host",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const credentialId = parseInt(id);
      const { targetHostId } = req.body;

      if (!credentialId || !targetHostId) {
        return res.status(400).json({
          success: false,
          error: "Credential ID and target host ID are required",
        });
      }

      try {
        const userId = (req as AuthenticatedRequest).userId;
        if (!userId) {
          return res.status(401).json({
            success: false,
            error: "Authentication required",
          });
        }

        const { SimpleDBOps } = await import("../../utils/simple-db-ops.js");
        const credential = await SimpleDBOps.select(
          db
            .select()
            .from(sshCredentials)
            .where(eq(sshCredentials.id, credentialId))
            .limit(1),
          "ssh_credentials",
          userId,
        );

        if (!credential || credential.length === 0) {
          return res.status(404).json({
            success: false,
            error: "Credential not found",
          });
        }

        const credData = credential[0] as unknown as CredentialBackend;

        if (credData.authType !== "key") {
          return res.status(400).json({
            success: false,
            error: "Only SSH key-based credentials can be deployed",
          });
        }

        const publicKey = credData.publicKey;
        if (!publicKey) {
          return res.status(400).json({
            success: false,
            error: "Public key is required for deployment",
          });
        }
        const targetHost = await SimpleDBOps.select(
          db.select().from(hosts).where(eq(hosts.id, targetHostId)).limit(1),
          "ssh_data",
          userId,
        );

        if (!targetHost || targetHost.length === 0) {
          return res.status(404).json({
            success: false,
            error: "Target host not found",
          });
        }

        const hostData = targetHost[0];

        const hostConfig = {
          ip: hostData.ip,
          port: hostData.port,
          username: hostData.username,
          authType: hostData.authType,
          password: hostData.password,
          privateKey: hostData.key,
          keyPassword: hostData.keyPassword,
        };

        if (hostData.authType === "credential" && hostData.credentialId) {
          const userId = (req as AuthenticatedRequest).userId;
          if (!userId) {
            return res.status(400).json({
              success: false,
              error: "Authentication required for credential resolution",
            });
          }

          try {
            const { SimpleDBOps } =
              await import("../../utils/simple-db-ops.js");
            const hostCredential = await SimpleDBOps.select(
              db
                .select()
                .from(sshCredentials)
                .where(eq(sshCredentials.id, hostData.credentialId as number))
                .limit(1),
              "ssh_credentials",
              userId,
            );

            if (hostCredential && hostCredential.length > 0) {
              const cred = hostCredential[0];

              hostConfig.authType = cred.authType;
              hostConfig.username = cred.username;

              if (cred.authType === "password") {
                hostConfig.password = cred.password;
              } else if (cred.authType === "key") {
                hostConfig.privateKey = cred.privateKey || cred.key;
                hostConfig.keyPassword = cred.keyPassword;
              }
            } else {
              return res.status(400).json({
                success: false,
                error: "Host credential not found",
              });
            }
          } catch {
            return res.status(500).json({
              success: false,
              error: "Failed to resolve host credentials",
            });
          }
        }

        const deployResult = await deploySSHKeyToHost(hostConfig, credData);

        if (deployResult.success) {
          res.json({
            success: true,
            message: deployResult.message || "SSH key deployed successfully",
          });
        } else {
          res.status(500).json({
            success: false,
            error: deployResult.error || "Deployment failed",
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to deploy SSH key",
        });
      }
    },
  );
}
