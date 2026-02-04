import type { WebSocket } from "ws";
import { db } from "../database/db/index.js";
import { sshData } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { sshLogger } from "../utils/logger.js";
import crypto from "crypto";

interface HostKeyVerificationData {
  scenario: "new" | "changed";
  ip: string;
  port: number;
  hostname?: string;
  fingerprint: string;
  oldFingerprint?: string;
  keyType: string;
  oldKeyType?: string;
  algorithm: string;
}

interface VerificationResponse {
  action: "accept" | "reject";
}

export class SSHHostKeyVerifier {
  /**
   * Creates a hostVerifier callback for ssh2 Client.connect()
   *
   * @param hostId - Database ID of the host (null for quick connect)
   * @param ip - IP address or hostname
   * @param port - SSH port
   * @param ws - WebSocket for user prompts (null for non-interactive connections)
   * @param userId - User ID for logging
   * @param isJumpHost - If true, auto-accepts without prompting
   * @returns async hostVerifier callback
   */
  static async createHostVerifier(
    hostId: number | null,
    ip: string,
    port: number,
    ws: WebSocket | null,
    userId: string,
    isJumpHost: boolean = false,
  ): Promise<(hostkey: Buffer, verify: (valid: boolean) => void) => void> {
    return (hostkey: Buffer, verify: (valid: boolean) => void): void => {
      (async () => {
        try {
          const fingerprint = hostkey.toString("hex");
          const keyType = this.getKeyType(hostkey);
          const algorithm = "sha256";

          if (!hostId) {
            sshLogger.info(
              "Host key verification skipped (no hostId - quick connect)",
              {
                operation: "host_key_skip",
                ip,
                port,
                fingerprint,
                keyType,
                userId,
              },
            );
            verify(true);
            return;
          }

          const host = await db.query.sshData.findFirst({
            where: eq(sshData.id, hostId),
          });

          if (!host) {
            sshLogger.warn(
              "Host not found in database during key verification",
              {
                operation: "host_key_no_host",
                hostId,
                ip,
                port,
                userId,
              },
            );
            verify(true);
            return;
          }

          if (!host.hostKeyFingerprint) {
            if (isJumpHost) {
              await this.storeHostKey(hostId, fingerprint, keyType, algorithm);
              sshLogger.info("Jump host key auto-accepted and stored", {
                operation: "host_key_stored",
                hostId,
                ip,
                port,
                fingerprint,
                keyType,
                userId,
                isJumpHost: true,
              });
              verify(true);
              return;
            }

            if (!ws) {
              sshLogger.warn(
                "No WebSocket available for host key verification prompt",
                {
                  operation: "host_key_no_ws",
                  hostId,
                  ip,
                  port,
                  userId,
                },
              );
              verify(true);
              return;
            }

            const accepted = await this.promptUserForNewKey(
              ws,
              ip,
              port,
              host.name || undefined,
              fingerprint,
              keyType,
              algorithm,
            );

            if (accepted) {
              await this.storeHostKey(hostId, fingerprint, keyType, algorithm);
              sshLogger.info("New host key accepted by user and stored", {
                operation: "host_key_stored",
                hostId,
                ip,
                port,
                fingerprint,
                keyType,
                userId,
              });
            } else {
              sshLogger.warn("User rejected new host key", {
                operation: "host_key_rejected",
                hostId,
                ip,
                port,
                fingerprint,
                keyType,
                userId,
              });
            }

            verify(accepted);
            return;
          }

          if (host.hostKeyFingerprint === fingerprint) {
            await db
              .update(sshData)
              .set({
                hostKeyLastVerified: new Date().toISOString(),
              })
              .where(eq(sshData.id, hostId));

            sshLogger.info("Host key verified successfully", {
              operation: "host_key_verified",
              hostId,
              ip,
              port,
              fingerprint,
              keyType,
              userId,
            });

            verify(true);
            return;
          }

          sshLogger.error("Host key mismatch detected - SECURITY WARNING", {
            operation: "host_key_mismatch",
            hostId,
            ip,
            port,
            oldFingerprint: host.hostKeyFingerprint,
            newFingerprint: fingerprint,
            oldKeyType: host.hostKeyType,
            newKeyType: keyType,
            userId,
            changeCount: host.hostKeyChangedCount || 0,
          });

          if (isJumpHost) {
            await this.updateHostKey(
              hostId,
              fingerprint,
              keyType,
              algorithm,
              host.hostKeyChangedCount || 0,
            );
            sshLogger.warn("Jump host key changed - auto-accepted", {
              operation: "host_key_updated",
              hostId,
              ip,
              port,
              fingerprint,
              keyType,
              userId,
              isJumpHost: true,
            });
            verify(true);
            return;
          }

          if (!ws) {
            sshLogger.error(
              "Host key changed - please connect via Terminal to verify the new key",
              {
                operation: "host_key_no_ws_reject",
                hostId,
                ip,
                port,
                userId,
                message:
                  "SSH host key has changed. For security, please open a Terminal connection to this host first to verify and accept the new key fingerprint.",
              },
            );
            verify(false);
            return;
          }

          const accepted = await this.promptUserForChangedKey(
            ws,
            ip,
            port,
            host.name || undefined,
            fingerprint,
            host.hostKeyFingerprint,
            keyType,
            host.hostKeyType || "unknown",
            algorithm,
          );

          if (accepted) {
            await this.updateHostKey(
              hostId,
              fingerprint,
              keyType,
              algorithm,
              host.hostKeyChangedCount || 0,
            );
            sshLogger.warn("Changed host key accepted by user", {
              operation: "host_key_updated",
              hostId,
              ip,
              port,
              oldFingerprint: host.hostKeyFingerprint,
              newFingerprint: fingerprint,
              userId,
              changeCount: (host.hostKeyChangedCount || 0) + 1,
            });
          } else {
            sshLogger.error("User rejected changed host key", {
              operation: "host_key_change_rejected",
              hostId,
              ip,
              port,
              userId,
            });
          }

          verify(accepted);
        } catch (error) {
          sshLogger.error("Error in host key verification", error, {
            operation: "host_key_error",
            hostId,
            ip,
            port,
            userId,
          });
          verify(false);
        }
      })();
    };
  }

  private static async storeHostKey(
    hostId: number,
    fingerprint: string,
    keyType: string,
    algorithm: string,
  ): Promise<void> {
    await db
      .update(sshData)
      .set({
        hostKeyFingerprint: fingerprint,
        hostKeyType: keyType,
        hostKeyAlgorithm: algorithm,
        hostKeyFirstSeen: new Date().toISOString(),
        hostKeyLastVerified: new Date().toISOString(),
      })
      .where(eq(sshData.id, hostId));
  }

  private static async updateHostKey(
    hostId: number,
    fingerprint: string,
    keyType: string,
    algorithm: string,
    currentChangeCount: number,
  ): Promise<void> {
    await db
      .update(sshData)
      .set({
        hostKeyFingerprint: fingerprint,
        hostKeyType: keyType,
        hostKeyAlgorithm: algorithm,
        hostKeyLastVerified: new Date().toISOString(),
        hostKeyChangedCount: currentChangeCount + 1,
      })
      .where(eq(sshData.id, hostId));
  }

  private static async promptUserForNewKey(
    ws: WebSocket,
    ip: string,
    port: number,
    hostname: string | undefined,
    fingerprint: string,
    keyType: string,
    algorithm: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        ws.removeListener("message", messageHandler);
        sshLogger.warn("Host key verification timeout (new key)", {
          operation: "host_key_timeout",
          ip,
          port,
        });
        resolve(false);
      }, 60000);

      const messageHandler = (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === "host_key_verification_response") {
            clearTimeout(timeout);
            ws.removeListener("message", messageHandler);

            const response = message.data as VerificationResponse;
            resolve(response.action === "accept");
          }
        } catch (error) {
          sshLogger.error(
            "Error parsing host key verification response",
            error,
          );
        }
      };

      ws.on("message", messageHandler);

      const verificationData: HostKeyVerificationData = {
        scenario: "new",
        ip,
        port,
        hostname,
        fingerprint,
        keyType,
        algorithm,
      };

      ws.send(
        JSON.stringify({
          type: "host_key_verification_required",
          data: verificationData,
        }),
      );
    });
  }

  private static async promptUserForChangedKey(
    ws: WebSocket,
    ip: string,
    port: number,
    hostname: string | undefined,
    fingerprint: string,
    oldFingerprint: string,
    keyType: string,
    oldKeyType: string,
    algorithm: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        ws.removeListener("message", messageHandler);
        sshLogger.error("Host key verification timeout (changed key)", {
          operation: "host_key_timeout",
          ip,
          port,
        });
        resolve(false);
      }, 120000);

      const messageHandler = (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === "host_key_verification_response") {
            clearTimeout(timeout);
            ws.removeListener("message", messageHandler);

            const response = message.data as VerificationResponse;
            resolve(response.action === "accept");
          }
        } catch (error) {
          sshLogger.error(
            "Error parsing host key verification response",
            error,
          );
        }
      };

      ws.on("message", messageHandler);

      const verificationData: HostKeyVerificationData = {
        scenario: "changed",
        ip,
        port,
        hostname,
        fingerprint,
        oldFingerprint,
        keyType,
        oldKeyType,
        algorithm,
      };

      ws.send(
        JSON.stringify({
          type: "host_key_changed",
          data: verificationData,
        }),
      );
    });
  }

  private static getKeyType(key: Buffer): string {
    try {
      // SSH public key format: 4-byte length + key type string
      if (key.length < 4) {
        return "unknown";
      }

      const typeLength = key.readUInt32BE(0);
      if (typeLength > key.length - 4 || typeLength > 256) {
        return "unknown";
      }

      const keyType = key.toString("utf8", 4, 4 + typeLength);

      // Return the key type if it's valid
      if (
        (keyType && keyType.startsWith("ssh-")) ||
        keyType.startsWith("ecdsa-")
      ) {
        return keyType;
      }

      return "unknown";
    } catch (error) {
      sshLogger.error("Error parsing SSH key type", error);
      return "unknown";
    }
  }
}
