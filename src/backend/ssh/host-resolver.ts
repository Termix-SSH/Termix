import {
  createCurrentHostResolutionRepository,
  createCurrentVaultProfileRepository,
} from "../database/repositories/factory.js";
import { logger } from "../utils/logger.js";
import {
  pickResolvedPassword,
  pickResolvedUsername,
  expandOidcUsername,
} from "./credential-username.js";
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
  const { PermissionManager } = await import("../utils/permission-manager.js");
  const access = await PermissionManager.getInstance().canAccessHost(
    userId,
    hostId,
    "read",
  );
  if (!access.hasAccess) return null;

  const repository = createCurrentHostResolutionRepository();
  const resolvedHost = await repository.findHostById(hostId, userId);
  if (!resolvedHost) return null;

  const host = resolvedHost as Record<string, unknown>;

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
      // Try user's own override credential first
      if (userId !== ownerId) {
        try {
          const overrideCredId = await repository.findOverrideCredentialId(
            hostId,
            userId,
          );
          if (overrideCredId) {
            const cred = (await repository.findCredentialByIdForUser(
              overrideCredId,
              userId,
            )) as Record<string, unknown> | null;
            if (cred) {
              host.password = cred.password;
              host.key = cred.key;
              host.keyPassword = cred.keyPassword;
              host.keyType = cred.keyType;
              host.username = pickResolvedUsername(
                host.username,
                cred.username,
                host.overrideCredentialUsername,
              );
              host.authType = cred.key
                ? "key"
                : cred.password
                  ? "password"
                  : "none";
              host.username = await expandOidcUsername(
                host.username as string | undefined,
                userId,
              );
              return host as unknown as SSHHost;
            }
          }
        } catch {
          // fall through to shared credential
        }

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
            host.username = pickResolvedUsername(
              host.username,
              sharedCred.username,
              host.overrideCredentialUsername,
            );
            host.authType = sharedCred.key
              ? "key"
              : sharedCred.password
                ? "password"
                : "none";
            host.username = await expandOidcUsername(
              host.username as string | undefined,
              userId,
            );
            return host as unknown as SSHHost;
          }
        } catch (e) {
          sshLogger.warn("Failed to get shared credential", {
            operation: "host_resolver_shared_credential",
            hostId,
            error: e instanceof Error ? e.message : "Unknown",
          });
        }

        return null;
      }

      const cred = (await repository.findCredentialByIdForUser(
        host.credentialId as number,
        ownerId,
      )) as Record<string, unknown> | null;

      if (cred) {
        host.password = pickResolvedPassword(host.password, cred.password);
        // Prefer the normalised private key; fall back to raw key field
        host.key = (cred.privateKey || cred.key) as string | null;
        host.keyPassword = cred.keyPassword;
        host.keyType = cred.keyType;
        // CA-signed certificate for cert-based auth
        (host as Record<string, unknown>).certPublicKey =
          cred.certPublicKey || null;
        host.username = pickResolvedUsername(
          host.username,
          cred.username,
          host.overrideCredentialUsername,
        );
        host.authType = host.key ? "key" : host.password ? "password" : "none";
      }
    } catch (e) {
      sshLogger.warn("Failed to resolve credential for host", {
        operation: "host_resolver_credential",
        hostId,
        error: e instanceof Error ? e.message : "Unknown",
      });
    }
  }

  host.username = await expandOidcUsername(
    host.username as string | undefined,
    userId,
  );

  // Resolve a Vault SSH signer profile (shared settings, no secrets). The
  // certificate itself is obtained per-user at connect time via Vault OIDC.
  if (host.vaultProfileId) {
    try {
      const profile = await createCurrentVaultProfileRepository().findById(
        host.vaultProfileId as number,
      );
      if (profile) {
        (host as Record<string, unknown>).vaultProfile = profile;
        host.authType = "vault";
      }
    } catch (e) {
      sshLogger.warn("Failed to resolve vault profile for host", {
        operation: "host_resolver_vault_profile",
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
