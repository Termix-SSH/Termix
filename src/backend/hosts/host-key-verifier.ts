import { pluginEvents, TOPICS } from "../plugins/events.js";
import type { WebSocket } from "ws";
import { createCurrentHostResolutionRepository } from "../database/repositories/factory.js";
import { sshLogger } from "../utils/logger.js";
import {
  HOST_KEY_MESSAGES,
  hostKeyTrustOnFirstUse,
  type HostKeyRefusalCode,
} from "./host-key-policy.js";

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

export interface HostVerifierOptions {
  /** Told why a key was refused, before ssh2 reports its own error. */
  onRefused?: (code: HostKeyRefusalCode, message: string) => void;
}

export class SSHHostKeyVerifier {
  /**
   * Pre-fetches the host record from the database so the verifier callback
   * during SSH key exchange doesn't need to do an async DB query. This keeps
   * the key exchange critical path fast, avoiding LoginGraceTime expiry on
   * the remote server (especially important for jump-host tunneled connections).
   */
  static async preloadHostData(hostId: number | null): Promise<{
    hostKeyFingerprint: string | null;
    hostKeyType: string | null;
    hostKeyAlgorithm: string | null;
    hostKeyChangedCount: number | null;
    name: string | null;
  } | null> {
    if (!hostId) return null;
    try {
      return await createCurrentHostResolutionRepository().findHostKeyVerificationData(
        hostId,
      );
    } catch {
      return null;
    }
  }

  static async createHostVerifier(
    hostId: number | null,
    ip: string,
    port: number,
    ws: WebSocket | null,
    userId: string,
    isJumpHost: boolean = false,
    preloadedHost?: Awaited<
      ReturnType<typeof SSHHostKeyVerifier.preloadHostData>
    >,
    verifierOptions: HostVerifierOptions = {},
  ): Promise<(hostkey: Buffer, verify: (valid: boolean) => void) => void> {
    const refuse = (
      verify: (valid: boolean) => void,
      code: HostKeyRefusalCode,
    ) => {
      try {
        verifierOptions.onRefused?.(code, HOST_KEY_MESSAGES[code]);
      } catch {
        // the refusal stands either way
      }
      verify(false);
    };
    return (hostkey: Buffer, verify: (valid: boolean) => void): void => {
      (async () => {
        try {
          const fingerprint = hostkey.toString("hex");
          const keyType = this.getKeyType(hostkey);
          const algorithm = "sha256";

          // An unsaved host (Quick Connect) has nowhere to keep the key, so the
          // user checks it for this session when there is a socket to ask on.
          if (!hostId && ws) {
            const accepted = await this.promptUserForNewKey(
              ws,
              ip,
              port,
              undefined,
              fingerprint,
              keyType,
              algorithm,
            );
            sshLogger.info(
              accepted
                ? "Quick connect host key accepted for this session"
                : "Quick connect host key rejected",
              {
                operation: "host_key_quick_connect",
                ip,
                port,
                fingerprint,
                userId,
              },
            );
            verify(accepted);
            return;
          }

          // Nobody can check the key and there is nowhere to pin it.
          if (!hostId) {
            const trusted = hostKeyTrustOnFirstUse();
            sshLogger.warn(
              trusted
                ? "Unsaved host key trusted for this session (trust on first use)"
                : "Unsaved host key refused, nobody to ask",
              {
                operation: trusted
                  ? "host_key_tofu_session"
                  : "host_key_unverified",
                ip,
                port,
                fingerprint,
                keyType,
                userId,
              },
            );
            if (trusted) verify(true);
            else refuse(verify, "HOST_KEY_UNVERIFIED");
            return;
          }

          const host =
            preloadedHost !== undefined
              ? preloadedHost
              : await createCurrentHostResolutionRepository().findHostKeyVerificationData(
                  hostId,
                );

          // No row means nothing to compare against and nowhere to save the
          // key, so it is never accepted silently (#1397): the user decides
          // when there is a socket to ask on, otherwise it is refused.
          if (!host) {
            if (!ws) {
              sshLogger.error(
                "Host not found in database during key verification, rejecting",
                {
                  operation: "host_key_no_host",
                  hostId,
                  ip,
                  port,
                  userId,
                },
              );
              verify(false);
              return;
            }
            const accepted = await this.promptUserForNewKey(
              ws,
              ip,
              port,
              undefined,
              fingerprint,
              keyType,
              algorithm,
            );
            sshLogger.warn(
              accepted
                ? "Key for a host missing from the database accepted for this session only"
                : "Key for a host missing from the database rejected",
              {
                operation: "host_key_no_host",
                hostId,
                ip,
                port,
                fingerprint,
                userId,
              },
            );
            verify(accepted);
            return;
          }

          if (!host.hostKeyFingerprint) {
            // With nobody to ask, the first key is only pinned when the admin
            // allows trust on first use.
            if (!ws) {
              if (!hostKeyTrustOnFirstUse()) {
                sshLogger.warn("Host has no saved key and nobody to ask", {
                  operation: "host_key_unverified",
                  hostId,
                  ip,
                  port,
                  userId,
                  isJumpHost,
                });
                refuse(verify, "HOST_KEY_UNVERIFIED");
                return;
              }
              await this.storeHostKey(hostId, fingerprint, keyType, algorithm);
              await this.auditFirstUse(hostId, host.name, userId, fingerprint);
              sshLogger.warn("Host key pinned on first use", {
                operation: "host_key_stored",
                hostId,
                ip,
                port,
                fingerprint,
                keyType,
                userId,
                isJumpHost,
              });
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
            sshLogger.info("Host key verified successfully", {
              operation: "host_key_verified",
              hostId,
              ip,
              port,
              fingerprint,
              keyType,
              userId,
            });

            // Verify first, then update the timestamp asynchronously so the
            // DB write doesn't delay the SSH key exchange critical path.
            verify(true);
            createCurrentHostResolutionRepository()
              .touchHostKeyLastVerified(hostId)
              .catch((err) => {
                sshLogger.error("Failed to update hostKeyLastVerified", err, {
                  operation: "host_key_update_timestamp",
                  hostId,
                });
              });
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

          if (!ws) {
            sshLogger.error(
              "Host key changed, open a terminal to check the new key",
              {
                operation: "host_key_no_ws_reject",
                hostId,
                ip,
                port,
                userId,
              },
            );
            refuse(verify, "HOST_KEY_CHANGED");
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

  private static async auditFirstUse(
    hostId: number,
    hostName: string | null,
    userId: string,
    fingerprint: string,
  ): Promise<void> {
    try {
      const audit = await import("../utils/audit-logger.js");
      const username = await audit.getAuditUsername(userId).catch(() => userId);
      await audit.logAudit({
        userId,
        username,
        action: "host_key_trusted_first_use",
        resourceType: "host",
        resourceId: String(hostId),
        resourceName: hostName ?? undefined,
        details: JSON.stringify({ fingerprint }),
        success: true,
      });
    } catch {
      // audit bookkeeping never blocks the connection
    }
  }

  private static async storeHostKey(
    hostId: number,
    fingerprint: string,
    keyType: string,
    algorithm: string,
  ): Promise<void> {
    await createCurrentHostResolutionRepository().storeHostKey(
      hostId,
      fingerprint,
      keyType,
      algorithm,
    );
  }

  private static async updateHostKey(
    hostId: number,
    fingerprint: string,
    keyType: string,
    algorithm: string,
    currentChangeCount: number,
  ): Promise<void> {
    await createCurrentHostResolutionRepository().updateHostKey(
      hostId,
      fingerprint,
      keyType,
      algorithm,
      currentChangeCount,
    );
    pluginEvents.emit(TOPICS.hostKeyUpdated, { hostId });
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
      if (key.length < 4) {
        return "unknown";
      }

      const typeLength = key.readUInt32BE(0);
      if (typeLength > key.length - 4 || typeLength > 256) {
        return "unknown";
      }

      const keyType = key.toString("utf8", 4, 4 + typeLength);

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
