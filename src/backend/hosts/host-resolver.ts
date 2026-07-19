import {
  createCurrentHostResolutionRepository,
  createCurrentVaultProfileRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import { logAudit } from "../utils/audit-logger.js";
import { logger } from "../utils/logger.js";
import {
  pickResolvedPassword,
  pickResolvedUsername,
  expandOidcUsername,
} from "./credential-username.js";
import type { SSHHost } from "../../types/index.js";
import type { HostAction } from "../utils/permission-manager.js";

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
    "connect",
  );
  if (!access.hasAccess) return null;

  const repository = createCurrentHostResolutionRepository();

  // Decrypt under the owner's DEK: shared hosts carry owner-encrypted fields
  // (socks5Password, inline auth, ...) that the requester's key cannot open.
  const ownerId = (await repository.findHostOwnerId(hostId)) ?? userId;
  const resolvedHost = await repository.findHostById(hostId, ownerId);
  if (!resolvedHost) return null;

  const host = resolvedHost as Record<string, unknown>;

  // Admin bypass resolves like the owner would; every such access is audited.
  const ownerEquivalent = userId === ownerId || access.isAdminBypass === true;

  if (access.isAdminBypass && userId !== ownerId) {
    try {
      const admin = await createCurrentUserRepository().findById(userId);
      void logAudit({
        userId,
        username: admin?.username ?? "unknown",
        action: "admin_connect_host",
        resourceType: "host",
        resourceId: String(hostId),
        resourceName: (host.name as string) || (host.ip as string) || "",
        details: JSON.stringify({ ownerId }),
        success: true,
      });
    } catch {
      // never block resolution on audit bookkeeping
    }
  }

  if (!ownerEquivalent) {
    // Owner-only operational secrets are never shared.
    host.sudoPassword = null;
    host.autostartPassword = null;
    host.autostartKey = null;
    host.autostartKeyPassword = null;
  }

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

  if (!ownerEquivalent) {
    const resolved = await resolveSharedSshSecrets(
      host,
      hostId,
      userId,
      repository,
    );
    if (!resolved) return null;
  } else if (host.credentialId) {
    try {
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
    ownerEquivalent ? ownerId : userId,
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
 * Fill in SSH auth secrets for a shared (non-owner) requester. Order:
 * the recipient's own override credential, then their re-encrypted share
 * snapshot. Secret-less auth types (opkssh, vault, agent, none) pass through
 * untouched. Returns false when a secret-bearing host has no usable source.
 */
async function resolveSharedSshSecrets(
  host: Record<string, unknown>,
  hostId: number,
  userId: string,
  repository: ReturnType<typeof createCurrentHostResolutionRepository>,
): Promise<boolean> {
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
        host.key = (cred.privateKey || cred.key) as string | null;
        host.keyPassword = cred.keyPassword;
        host.keyType = cred.keyType;
        host.username = pickResolvedUsername(
          host.username,
          cred.username,
          host.overrideCredentialUsername,
        );
        host.authType = host.key ? "key" : host.password ? "password" : "none";
        return true;
      }
    }
  } catch {
    // fall through to the share snapshot
  }

  try {
    const { SharedHostSecretsManager } =
      await import("../utils/shared-host-secrets-manager.js");
    const secret =
      await SharedHostSecretsManager.getInstance().getSecretForUser(
        hostId,
        userId,
        "ssh",
      );
    if (secret) {
      host.password = secret.password;
      host.key = secret.key;
      host.keyPassword = secret.keyPassword;
      host.keyType = secret.keyType;
      host.username = pickResolvedUsername(
        host.username,
        secret.username,
        host.overrideCredentialUsername,
      );
      host.authType = secret.key
        ? "key"
        : secret.password
          ? "password"
          : "none";
      return true;
    }
  } catch (e) {
    sshLogger.warn("Failed to get shared host secret", {
      operation: "host_resolver_shared_secret",
      hostId,
      error: e instanceof Error ? e.message : "Unknown",
    });
  }

  const needsSecrets =
    !!host.credentialId ||
    host.authType === "password" ||
    host.authType === "key" ||
    host.authType === "credential";
  if (!needsSecrets) return true;

  return false;
}

/**
 * Check if a user has access to a host (owner or shared access).
 */
export async function checkHostAccess(
  hostId: number,
  userId: string,
  hostUserId: string,
  requiredPermission: HostAction = "connect",
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
