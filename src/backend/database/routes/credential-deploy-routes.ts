import { getErrorMessage } from "../../utils/error-message.js";
import type {
  AuthenticatedRequest,
  CredentialBackend,
} from "../../../types/index.js";
import type { Request, RequestHandler, Response, Router } from "express";
import type { Client as SshClient } from "ssh2";
import { createCurrentHostResolutionRepository } from "../repositories/factory.js";
import { connectHost } from "../../hosts/connect/connect-host.js";
import type { SshConnectHost } from "../../hosts/connect/types.js";
import { resolveHostById } from "../../hosts/host-resolver.js";

function describeDeployError(err: unknown): string {
  const message = getErrorMessage(err, "Connection failed");
  if (message.includes("All configured authentication methods failed")) {
    return "Authentication failed. Please check your credentials and ensure the SSH service is running.";
  }
  if (message.includes("ENOTFOUND") || message.includes("ENOENT")) {
    return "Could not resolve hostname or connect to server.";
  }
  if (message.includes("ECONNREFUSED")) {
    return "Connection refused. The server may not be running or the port may be incorrect.";
  }
  if (message.includes("ETIMEDOUT")) {
    return "Connection timed out. Check your network connection and server availability.";
  }
  if (
    message.includes("authentication failed") ||
    message.includes("Permission denied")
  ) {
    return "Authentication failed. Please check your username and password/key.";
  }
  if (message === "SSH connection timeout") return "Connection timeout";
  return message;
}

async function deploySSHKeyToHost(
  host: SshConnectHost,
  userId: string,
  credData: CredentialBackend,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const publicKey = credData.publicKey as string;

  let conn: SshClient;
  try {
    ({ client: conn } = await connectHost(host, {
      userId,
      purpose: "credential-deploy",
      timeoutMs: 120000,
    }));
  } catch (error) {
    return { success: false, error: describeDeployError(error) };
  }

  return new Promise((resolve) => {
    void (async () => {
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
            if (!/^[A-Za-z0-9+/]+={0,2}$/.test(keyPattern)) {
              clearTimeout(checkTimeout);
              return rejectCheck(new Error("Invalid public key data"));
            }

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
            if (!/^[A-Za-z0-9+/]+={0,2}$/.test(keyPattern)) {
              clearTimeout(verifyTimeout);
              return rejectVerify(new Error("Invalid public key data"));
            }
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
          error: getErrorMessage(error, "Deployment failed"),
        });
      }
    })();
  });
}

export function registerCredentialDeployRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
  requireCredentialViewPermission: RequestHandler,
  requireHostEditPermission: RequestHandler,
  requireDataAccess: RequestHandler,
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
    requireCredentialViewPermission,
    requireHostEditPermission,
    requireDataAccess,
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

        const repository = createCurrentHostResolutionRepository();
        const credential = await repository.findCredentialByIdForUser(
          credentialId,
          userId,
        );

        if (!credential) {
          return res.status(404).json({
            success: false,
            error: "Credential not found",
          });
        }

        const credData = credential as unknown as CredentialBackend;

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
        // Writing authorized_keys is an owner action, so ownership is checked
        // before the shared resolver fills in the credentials.
        const hostData = await repository.findHostByIdForUser(
          targetHostId,
          userId,
        );

        if (!hostData) {
          return res.status(404).json({
            success: false,
            error: "Target host not found",
          });
        }

        const resolvedHost = await resolveHostById(targetHostId, userId);
        if (!resolvedHost) {
          return res.status(400).json({
            success: false,
            error: "Host credential not found",
          });
        }

        const deployResult = await deploySSHKeyToHost(
          resolvedHost as unknown as SshConnectHost,
          userId,
          credData,
        );

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
          error: getErrorMessage(error, "Failed to deploy SSH key"),
        });
      }
    },
  );
}
