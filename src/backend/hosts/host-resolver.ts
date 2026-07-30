import {
  createCurrentHostResolutionRepository,
  createCurrentVaultProfileRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import type { HostResolutionHostRecord } from "../database/repositories/host-resolution-repository.js";
import { logAudit } from "../utils/audit-logger.js";
import { logger } from "../utils/logger.js";
import { resolveRecipientSharedHostAuthentication } from "../utils/shared-host-auth-resolver.js";
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
  if (
    !ownerEquivalent &&
    host.terminalConfig &&
    typeof host.terminalConfig === "object" &&
    !Array.isArray(host.terminalConfig)
  ) {
    host.terminalConfig = {
      ...(host.terminalConfig as Record<string, unknown>),
      sudoPassword: null,
    };
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

  let sharedAuthResolution: SharedAuthResolution | undefined;
  if (!ownerEquivalent) {
    sharedAuthResolution = await resolveRecipientSshAuth(host, hostId, userId);
    if (!sharedAuthResolution) return null;
  } else {
    let effectiveCredentialId = host.credentialId as number | null | undefined;
    if (
      !effectiveCredentialId &&
      host.authType === "credential" &&
      host.folder
    ) {
      try {
        effectiveCredentialId = await repository.findFolderCredentialId(
          ownerId,
          host.folder as string,
        );
      } catch (e) {
        sshLogger.warn("Failed to resolve folder credential for host", {
          operation: "host_resolver_folder_credential",
          hostId,
          error: e instanceof Error ? e.message : "Unknown",
        });
      }
    }

    if (effectiveCredentialId) {
      try {
        const cred = (await repository.findCredentialByIdForUser(
          effectiveCredentialId,
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
          host.authType = host.key
            ? "key"
            : host.password
              ? "password"
              : "none";
        }
      } catch (e) {
        sshLogger.warn("Failed to resolve credential for host", {
          operation: "host_resolver_credential",
          hostId,
          error: e instanceof Error ? e.message : "Unknown",
        });
      }
    }
  }

  host.username = await expandOidcUsername(
    host.username as string | undefined,
    ownerEquivalent ? ownerId : userId,
  );

  // Resolve a Vault SSH signer profile (shared settings, no secrets). The
  // certificate itself is obtained per-user at connect time via Vault OIDC.
  if (host.vaultProfileId && sharedAuthResolution !== "recipient-override") {
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
 * Resolve SSH auth for a shared (non-owner) requester without exposing the
 * owner's password, key, or credential reference. A recipient-owned override
 * fully replaces the host auth. An owner-enabled shared snapshot is the
 * fallback; otherwise only secret-less auth types pass.
 */
type SharedAuthResolution =
  | "recipient-override"
  | "shared-snapshot"
  | "shared-agent"
  | "secretless";

async function resolveRecipientSshAuth(
  host: Record<string, unknown>,
  hostId: number,
  userId: string,
): Promise<SharedAuthResolution | null> {
  const ownerAuthHost = { ...host } as HostResolutionHostRecord;

  // The host row is decrypted under its owner's DEK so connection settings are
  // available. Remove owner SSH auth before resolving anything for a recipient.
  host.password = null;
  host.key = null;
  host.keyPassword = null;
  host.keyType = null;
  host.certPublicKey = null;
  host.credentialId = null;

  try {
    const resolution = await resolveRecipientSharedHostAuthentication(
      ownerAuthHost,
      hostId,
      userId,
      "ssh",
    );

    if (resolution.source === "personal-override") {
      const credential = resolution.credential;
      host.password = credential.password;
      host.key = credential.privateKey || credential.key;
      host.keyPassword = credential.keyPassword;
      host.keyType = credential.keyType;
      host.certPublicKey = credential.certPublicKey || null;
      host.username = credential.username || host.username;
      host.authType = host.key ? "key" : host.password ? "password" : "none";
      return "recipient-override";
    }

    if (resolution.source === "owner-shared") {
      if (resolution.authType === "agent") {
        return "shared-agent";
      }
      const sharedAuth = resolution.secret;
      if (sharedAuth) {
        host.password = sharedAuth.password || null;
        host.key = sharedAuth.key || null;
        host.keyPassword = sharedAuth.keyPassword || null;
        host.keyType = sharedAuth.keyType || null;
        host.username = pickResolvedUsername(
          host.username,
          sharedAuth.username,
          host.overrideCredentialUsername,
        );
        host.authType = host.key ? "key" : host.password ? "password" : "none";
        return "shared-snapshot";
      }
    }

    if (resolution.source === "secretless") {
      return "secretless";
    }
  } catch {
    // A missing/deleted override or snapshot behaves like unavailable auth.
  }

  return null;
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
