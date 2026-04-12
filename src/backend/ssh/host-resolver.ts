import { getDb } from "../database/db/index.js";
import { hosts, sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { logger } from "../utils/logger.js";
import type { SSHHost } from "../../types/index.js";

const sshLogger = logger;

/**
 * Resolve a host with its credentials server-side by hostId.
 * This avoids passing credentials through the frontend.
 */
export async function resolveHostById(
  hostId: number,
  userId: string,
): Promise<SSHHost | null> {
  const db = getDb();

  const hostResults = await SimpleDBOps.select(
    db.select().from(hosts).where(eq(hosts.id, hostId)),
    "ssh_data",
    userId,
  );

  if (hostResults.length === 0) return null;

  const host = hostResults[0] as Record<string, unknown>;

  // Parse JSON fields
  if (typeof host.jumpHosts === "string" && host.jumpHosts) {
    try {
      host.jumpHosts = JSON.parse(host.jumpHosts as string);
    } catch {
      host.jumpHosts = [];
    }
  }
  if (typeof host.tunnelConnections === "string") {
    try {
      host.tunnelConnections = JSON.parse(host.tunnelConnections as string);
    } catch {
      host.tunnelConnections = [];
    }
  }
  if (typeof host.statsConfig === "string" && host.statsConfig) {
    try {
      host.statsConfig = JSON.parse(host.statsConfig as string);
    } catch {
      host.statsConfig = undefined;
    }
  }
  if (typeof host.terminalConfig === "string" && host.terminalConfig) {
    try {
      host.terminalConfig = JSON.parse(host.terminalConfig as string);
    } catch {
      host.terminalConfig = undefined;
    }
  }
  if (typeof host.socks5ProxyChain === "string" && host.socks5ProxyChain) {
    try {
      host.socks5ProxyChain = JSON.parse(host.socks5ProxyChain as string);
    } catch {
      host.socks5ProxyChain = [];
    }
  }
  if (typeof host.quickActions === "string" && host.quickActions) {
    try {
      host.quickActions = JSON.parse(host.quickActions as string);
    } catch {
      host.quickActions = [];
    }
  }

  // Resolve credential if using credential-based auth
  if (host.credentialId) {
    const ownerId = (host.userId || userId) as string;
    try {
      // Try shared credential first for non-owner users
      if (userId !== ownerId) {
        try {
          const { SharedCredentialManager } =
            await import("../utils/shared-credential-manager.js");
          const sharedCredManager = SharedCredentialManager.getInstance();
          const sharedCred = await sharedCredManager.getSharedCredentialForUser(
            hostId,
            userId,
          );
          if (sharedCred) {
            host.password = sharedCred.password;
            host.key = sharedCred.key;
            host.keyPassword = sharedCred.keyPassword;
            host.keyType = sharedCred.keyType;
            if (!host.overrideCredentialUsername) {
              host.username = sharedCred.username;
            }
            host.authType = sharedCred.key
              ? "key"
              : sharedCred.password
                ? "password"
                : "none";
            return host as unknown as SSHHost;
          }
        } catch (e) {
          sshLogger.warn("Failed to get shared credential, falling back", {
            operation: "host_resolver_shared_credential",
            hostId,
            error: e instanceof Error ? e.message : "Unknown",
          });
        }
      }

      const credentials = await SimpleDBOps.select(
        db
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, host.credentialId as number),
              eq(sshCredentials.userId, ownerId),
            ),
          ),
        "ssh_credentials",
        ownerId,
      );

      if (credentials.length > 0) {
        const cred = credentials[0] as Record<string, unknown>;
        host.password = cred.password;
        host.key = cred.key;
        host.keyPassword = cred.keyPassword;
        host.keyType = cred.keyType;
        if (!host.overrideCredentialUsername) {
          host.username = cred.username;
        }
        host.authType = cred.key ? "key" : cred.password ? "password" : "none";
      }
    } catch (e) {
      sshLogger.warn("Failed to resolve credential for host", {
        operation: "host_resolver_credential",
        hostId,
        error: e instanceof Error ? e.message : "Unknown",
      });
    }
  }

  return host as unknown as SSHHost;
}

/**
 * Check if a user has access to a host (owner or shared access).
 */
export async function checkHostAccess(
  hostId: number,
  userId: string,
  hostUserId: string,
  requiredPermission: "read" | "execute" = "execute",
): Promise<boolean> {
  if (userId === hostUserId) return true;

  try {
    const { PermissionManager } =
      await import("../utils/permission-manager.js");
    const permissionManager = PermissionManager.getInstance();
    const accessInfo = await permissionManager.canAccessHost(
      userId,
      hostId,
      requiredPermission,
    );
    return accessInfo.hasAccess;
  } catch {
    return false;
  }
}
