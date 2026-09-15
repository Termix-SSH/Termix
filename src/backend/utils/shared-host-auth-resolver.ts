import {
  isSupportedAuthOverrideProtocol,
  type AuthOverrideProtocol,
} from "../../types/auth-protocols.js";
import {
  createCurrentHostResolutionRepository,
  createCurrentSharedHostAuthOverrideRepository,
} from "../database/repositories/factory.js";
import type {
  HostResolutionCredentialRecord,
  HostResolutionHostRecord,
} from "../database/repositories/host-resolution-repository.js";
import {
  SharedHostSecretsManager,
  type SharedSecretData,
} from "./shared-host-secrets-manager.js";

export type RecipientSharedHostAuthResolution =
  | {
      source: "personal-override";
      credentialId: number;
      credential: HostResolutionCredentialRecord;
    }
  | {
      source: "owner-shared";
      authType: string;
      secret: SharedSecretData | null;
    }
  | { source: "secretless" }
  | { source: "required" };

export function requiresPersonalHostAuthentication(
  host: Pick<HostResolutionHostRecord, "credentialId" | "authType">,
  protocol: AuthOverrideProtocol,
): boolean {
  // Owner auth for RDP/VNC/Telnet is snapshotted for every recipient, so only
  // SSH, which sits behind shareSshAuth, can leave a recipient without auth.
  if (protocol !== "ssh") return false;
  return (
    !!host.credentialId ||
    host.authType === "password" ||
    host.authType === "key" ||
    host.authType === "credential" ||
    host.authType === "agent"
  );
}

/** Whether the owner's auth for this protocol is available to recipients. */
export function isOwnerAuthShared(
  host: Pick<HostResolutionHostRecord, "shareSshAuth">,
  protocol: AuthOverrideProtocol,
): boolean {
  return protocol === "ssh" ? !!host.shareSshAuth : true;
}

/**
 * Applies the shared-host authentication precedence independently from any
 * transport: recipient override, shared owner auth, secretless auth, then
 * "required".
 */
export async function resolveRecipientSharedHostAuthentication(
  host: HostResolutionHostRecord,
  hostId: number,
  userId: string,
  protocol: AuthOverrideProtocol,
): Promise<RecipientSharedHostAuthResolution> {
  if (!isSupportedAuthOverrideProtocol(protocol)) {
    throw new Error(
      `${protocol.toUpperCase()} shared-host authentication is not implemented`,
    );
  }

  const repository = createCurrentHostResolutionRepository();
  let overrideCredentialId: number | null = null;
  try {
    overrideCredentialId =
      await createCurrentSharedHostAuthOverrideRepository().findCredentialId(
        hostId,
        userId,
        protocol,
      );
  } catch {
    // A missing/deleted override behaves like no personal credential.
  }

  if (overrideCredentialId) {
    const credential = await repository.findCredentialByIdForUser(
      overrideCredentialId,
      userId,
    );
    if (credential) {
      return {
        source: "personal-override",
        credentialId: overrideCredentialId,
        credential,
      };
    }
  }

  if (isOwnerAuthShared(host, protocol)) {
    if (protocol === "ssh" && host.authType === "agent") {
      return {
        source: "owner-shared",
        authType: "agent",
        secret: null,
      };
    }

    try {
      const secret =
        await SharedHostSecretsManager.getInstance().getSecretForUser(
          hostId,
          userId,
          protocol,
        );
      if (secret) {
        return {
          source: "owner-shared",
          authType: secret.authType,
          secret,
        };
      }
    } catch {
      // An unreadable owner snapshot cannot expose the owner's auth.
    }
  }

  return requiresPersonalHostAuthentication(host, protocol)
    ? { source: "required" }
    : { source: "secretless" };
}
