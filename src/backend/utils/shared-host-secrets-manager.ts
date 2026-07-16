import {
  createCurrentHostResolutionRepository,
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentSharedHostSecretsRepository,
} from "../database/repositories/factory.js";
import type {
  SharedHostSecretRecord,
  ShareProtocol,
} from "../database/repositories/shared-host-secrets-repository.js";
import type { HostResolutionHostRecord } from "../database/repositories/host-resolution-repository.js";
import { DataCrypto } from "./data-crypto.js";
import { FieldCrypto } from "./field-crypto.js";
import { databaseLogger } from "./logger.js";

export interface SharedSecretData {
  username?: string;
  authType: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  domain?: string;
}

interface ProtocolSnapshot {
  protocol: ShareProtocol;
  sourceType: "credential" | "inline";
  originalCredentialId: number | null;
  data: SharedSecretData;
}

function snapshotRecordId(
  hostAccessId: number,
  targetUserId: string,
  protocol: ShareProtocol,
): string {
  return `shared-${hostAccessId}-${targetUserId}-${protocol}`;
}

// Mirrors the connection-type migration fallback in transformHostResponse():
// old hosts only set connectionType, the per-protocol enable flags came later.
function enabledProtocols(
  host: HostResolutionHostRecord,
): Record<ShareProtocol, boolean> {
  const ct = host.connectionType;
  const rdp = !!host.enableRdp;
  const vnc = !!host.enableVnc;
  const telnet = !!host.enableTelnet;
  const isMigratedNonSsh = !rdp && !vnc && !telnet && !!ct && ct !== "ssh";

  return {
    ssh: isMigratedNonSsh ? false : host.enableSsh !== false,
    rdp: isMigratedNonSsh ? ct === "rdp" : rdp,
    vnc: isMigratedNonSsh ? ct === "vnc" : vnc,
    telnet: isMigratedNonSsh ? ct === "telnet" : telnet,
  };
}

// Per-recipient copies of a shared host's connection secrets, re-encrypted
// under the recipient's DEK. Every enabled protocol gets its own snapshot;
// secret-less auth types (opkssh, vault, agent, none, ...) produce none.
class SharedHostSecretsManager {
  private static instance: SharedHostSecretsManager;

  private constructor() {}

  static getInstance(): SharedHostSecretsManager {
    if (!this.instance) {
      this.instance = new SharedHostSecretsManager();
    }
    return this.instance;
  }

  async snapshotForUser(
    hostAccessId: number,
    hostId: number,
    targetUserId: string,
    ownerId: string,
  ): Promise<void> {
    if (targetUserId === ownerId) return;

    try {
      const targetDEK = DataCrypto.validateUserAccess(targetUserId);
      DataCrypto.validateUserAccess(ownerId);

      const host = await createCurrentHostResolutionRepository().findHostById(
        hostId,
        ownerId,
      );
      if (!host) {
        throw new Error(`Host ${hostId} not found`);
      }

      const snapshots = await this.collectProtocolSnapshots(host, ownerId);
      const repository = createCurrentSharedHostSecretsRepository();

      for (const snapshot of snapshots) {
        const recordId = snapshotRecordId(
          hostAccessId,
          targetUserId,
          snapshot.protocol,
        );
        const encrypt = (value: string | undefined, fieldName: string) =>
          value
            ? FieldCrypto.encryptField(value, targetDEK, recordId, fieldName)
            : null;

        await repository.upsert({
          hostAccessId,
          targetUserId,
          protocol: snapshot.protocol,
          sourceType: snapshot.sourceType,
          originalCredentialId: snapshot.originalCredentialId,
          encryptedUsername: encrypt(snapshot.data.username, "username"),
          encryptedAuthType: snapshot.data.authType,
          encryptedPassword: encrypt(snapshot.data.password, "password"),
          encryptedKey: encrypt(snapshot.data.key, "key"),
          encryptedKeyPassword: encrypt(
            snapshot.data.keyPassword,
            "key_password",
          ),
          encryptedKeyType: snapshot.data.keyType || null,
          encryptedDomain: encrypt(snapshot.data.domain, "domain"),
        });
      }

      await repository.deleteForHostAccessAndTarget(
        hostAccessId,
        targetUserId,
        snapshots.map((snapshot) => snapshot.protocol),
      );
    } catch (error) {
      databaseLogger.error("Failed to snapshot shared host secrets", error, {
        operation: "shared_host_secrets_snapshot",
        hostAccessId,
        hostId,
        targetUserId,
      });
      throw error;
    }
  }

  async snapshotForRole(
    hostAccessId: number,
    hostId: number,
    roleId: number,
    ownerId: string,
  ): Promise<void> {
    const roleUserIds =
      await createCurrentRoleRepository().listRoleUserIds(roleId);

    for (const userId of roleUserIds) {
      try {
        await this.snapshotForUser(hostAccessId, hostId, userId, ownerId);
      } catch (error) {
        databaseLogger.error(
          "Failed to snapshot shared host secrets for role member",
          error,
          {
            operation: "shared_host_secrets_snapshot_role",
            hostAccessId,
            roleId,
            userId,
          },
        );
      }
    }
  }

  async snapshotForRoleMember(
    roleId: number,
    targetUserId: string,
  ): Promise<void> {
    const hostsSharedWithRole =
      await createCurrentRbacAccessRepository().listRoleHostAccessCredentialSources(
        roleId,
      );

    for (const sharedHost of hostsSharedWithRole) {
      try {
        await this.snapshotForUser(
          sharedHost.hostAccessId,
          sharedHost.hostId,
          targetUserId,
          sharedHost.hostOwnerId,
        );
      } catch (error) {
        databaseLogger.error(
          "Failed to snapshot shared host secrets for role member",
          error,
          {
            operation: "shared_host_secrets_snapshot_role_member",
            roleId,
            targetUserId,
            hostId: sharedHost.hostId,
          },
        );
      }
    }
  }

  async snapshotForUserRoles(userId: string): Promise<void> {
    const roleIds = await createCurrentRoleRepository().listUserRoleIds(userId);

    for (const roleId of roleIds) {
      await this.snapshotForRoleMember(roleId, userId);
    }
  }

  // Re-snapshot every active grant on a host. Called after the owner (or an
  // editor) changes the host so recipients keep working secrets.
  async resyncHost(hostId: number): Promise<void> {
    const hostResolutionRepository = createCurrentHostResolutionRepository();
    const ownerId = await hostResolutionRepository.findHostOwnerId(hostId);
    if (!ownerId) return;

    const grants =
      await createCurrentRbacAccessRepository().listActiveHostAccessGrants(
        hostId,
      );
    if (grants.length === 0) return;

    const roleRepository = createCurrentRoleRepository();

    for (const grant of grants) {
      const targetUserIds = grant.userId
        ? [grant.userId]
        : grant.roleId
          ? await roleRepository.listRoleUserIds(grant.roleId)
          : [];

      for (const targetUserId of targetUserIds) {
        if (targetUserId === ownerId) continue;
        try {
          await this.snapshotForUser(grant.id, hostId, targetUserId, ownerId);
        } catch (error) {
          databaseLogger.warn(
            "Skipping shared host secret resync for recipient",
            {
              operation: "shared_host_secrets_resync_skip",
              hostId,
              hostAccessId: grant.id,
              targetUserId,
              error: error instanceof Error ? error.message : "Unknown error",
            },
          );
        }
      }
    }
  }

  // Re-snapshot every shared host that references a credential after the
  // owner edits that credential.
  async resyncHostsForCredential(
    credentialId: number,
    ownerId: string,
  ): Promise<void> {
    try {
      const hostIds =
        await createCurrentSharedHostSecretsRepository().findHostIdsReferencingCredential(
          ownerId,
          credentialId,
        );

      for (const hostId of hostIds) {
        await this.resyncHost(hostId);
      }
    } catch (error) {
      databaseLogger.error(
        "Failed to resync shared host secrets for credential",
        error,
        {
          operation: "shared_host_secrets_resync_credential",
          credentialId,
        },
      );
    }
  }

  async getSecretForUser(
    hostId: number,
    userId: string,
    protocol: ShareProtocol,
  ): Promise<SharedSecretData | null> {
    try {
      const userDEK = DataCrypto.validateUserAccess(userId);

      const secret =
        await createCurrentSharedHostSecretsRepository().findForHostUserProtocol(
          hostId,
          userId,
          protocol,
        );

      if (!secret) return null;

      return this.decryptSnapshot(secret, userDEK);
    } catch (error) {
      databaseLogger.error("Failed to get shared host secret", error, {
        operation: "shared_host_secrets_get",
        hostId,
        userId,
        protocol,
      });
      throw error;
    }
  }

  async deleteForHostAccess(hostAccessId: number): Promise<void> {
    try {
      await createCurrentSharedHostSecretsRepository().deleteByHostAccessId(
        hostAccessId,
      );
    } catch (error) {
      databaseLogger.error(
        "Failed to delete shared host secrets for access grant",
        error,
        {
          operation: "shared_host_secrets_delete_access",
          hostAccessId,
        },
      );
    }
  }

  async deleteForUser(userId: string): Promise<void> {
    try {
      await createCurrentSharedHostSecretsRepository().deleteByTargetUserId(
        userId,
      );
    } catch (error) {
      databaseLogger.error(
        "Failed to delete shared host secrets for user",
        error,
        {
          operation: "shared_host_secrets_delete_user",
          userId,
        },
      );
    }
  }

  async deleteForCredential(credentialId: number): Promise<void> {
    try {
      await createCurrentSharedHostSecretsRepository().deleteByOriginalCredentialId(
        credentialId,
      );
    } catch (error) {
      databaseLogger.error(
        "Failed to delete shared host secrets for credential",
        error,
        {
          operation: "shared_host_secrets_delete_credential",
          credentialId,
        },
      );
    }
  }

  private async collectProtocolSnapshots(
    host: HostResolutionHostRecord,
    ownerId: string,
  ): Promise<ProtocolSnapshot[]> {
    const repository = createCurrentHostResolutionRepository();
    const enabled = enabledProtocols(host);
    const snapshots: ProtocolSnapshot[] = [];

    if (enabled.ssh) {
      if (host.credentialId) {
        const credential = await repository.findCredentialByIdForUser(
          host.credentialId,
          ownerId,
        );
        if (credential) {
          snapshots.push({
            protocol: "ssh",
            sourceType: "credential",
            originalCredentialId: host.credentialId,
            data: {
              username: credential.username || undefined,
              authType: credential.authType,
              password: credential.password || undefined,
              key: credential.privateKey || credential.key || undefined,
              keyPassword: credential.keyPassword || undefined,
              keyType: credential.keyType || undefined,
            },
          });
        }
      } else if (
        (host.authType === "password" && host.password) ||
        (host.authType === "key" && host.key)
      ) {
        snapshots.push({
          protocol: "ssh",
          sourceType: "inline",
          originalCredentialId: null,
          data: {
            username: host.username || undefined,
            authType: host.authType,
            password: host.password || undefined,
            key: host.key || undefined,
            keyPassword: host.keyPassword || undefined,
            keyType: host.keyType || undefined,
          },
        });
      }
    }

    if (enabled.rdp) {
      const rdpAuthType =
        host.rdpAuthType || (host.rdpCredentialId ? "credential" : "direct");
      if (rdpAuthType === "credential" && host.rdpCredentialId) {
        const credential = await repository.findCredentialByIdForUser(
          host.rdpCredentialId,
          ownerId,
        );
        if (credential) {
          snapshots.push({
            protocol: "rdp",
            sourceType: "credential",
            originalCredentialId: host.rdpCredentialId,
            data: {
              username: credential.username || undefined,
              authType: "credential",
              password: credential.password || undefined,
              domain: host.rdpDomain || undefined,
            },
          });
        }
      } else if (host.rdpUser || host.rdpPassword) {
        snapshots.push({
          protocol: "rdp",
          sourceType: "inline",
          originalCredentialId: null,
          data: {
            username: host.rdpUser || undefined,
            authType: "direct",
            password: host.rdpPassword || undefined,
            domain: host.rdpDomain || undefined,
          },
        });
      }
    }

    if (enabled.vnc) {
      const vncAuthType =
        host.vncAuthType || (host.vncCredentialId ? "credential" : "direct");
      if (vncAuthType === "credential" && host.vncCredentialId) {
        const credential = await repository.findCredentialByIdForUser(
          host.vncCredentialId,
          ownerId,
        );
        if (credential) {
          snapshots.push({
            protocol: "vnc",
            sourceType: "credential",
            originalCredentialId: host.vncCredentialId,
            data: {
              username: credential.username || undefined,
              authType: "credential",
              password: credential.password || undefined,
            },
          });
        }
      } else if (host.vncUser || host.vncPassword) {
        snapshots.push({
          protocol: "vnc",
          sourceType: "inline",
          originalCredentialId: null,
          data: {
            username: host.vncUser || undefined,
            authType: "direct",
            password: host.vncPassword || undefined,
          },
        });
      }
    }

    if (enabled.telnet) {
      const telnetAuthType =
        host.telnetAuthType ||
        (host.telnetCredentialId ? "credential" : "direct");
      if (telnetAuthType === "credential" && host.telnetCredentialId) {
        const credential = await repository.findCredentialByIdForUser(
          host.telnetCredentialId,
          ownerId,
        );
        if (credential) {
          snapshots.push({
            protocol: "telnet",
            sourceType: "credential",
            originalCredentialId: host.telnetCredentialId,
            data: {
              username: credential.username || undefined,
              authType: "credential",
              password: credential.password || undefined,
            },
          });
        }
      } else if (host.telnetUser || host.telnetPassword) {
        snapshots.push({
          protocol: "telnet",
          sourceType: "inline",
          originalCredentialId: null,
          data: {
            username: host.telnetUser || undefined,
            authType: "direct",
            password: host.telnetPassword || undefined,
          },
        });
      }
    }

    return snapshots;
  }

  private decryptSnapshot(
    secret: SharedHostSecretRecord,
    userDEK: Buffer,
  ): SharedSecretData {
    const recordId = snapshotRecordId(
      secret.hostAccessId,
      secret.targetUserId,
      secret.protocol as ShareProtocol,
    );
    const decrypt = (value: string | null, fieldName: string) =>
      value
        ? FieldCrypto.decryptField(value, userDEK, recordId, fieldName)
        : undefined;

    return {
      username: decrypt(secret.encryptedUsername, "username"),
      authType: secret.encryptedAuthType || "password",
      password: decrypt(secret.encryptedPassword, "password"),
      key: decrypt(secret.encryptedKey, "key"),
      keyPassword: decrypt(secret.encryptedKeyPassword, "key_password"),
      keyType: secret.encryptedKeyType || undefined,
      domain: decrypt(secret.encryptedDomain, "domain"),
    };
  }
}

export { SharedHostSecretsManager };
