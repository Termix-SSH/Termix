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
import type { SharedSecretData } from "./shared-host-secrets-manager.js";
import { SharedHostSecretsManager } from "./shared-host-secrets-manager.js";

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
  switch (protocol) {
    case "ssh":
      return (
        !!host.credentialId ||
        host.authType === "password" ||
        host.authType === "key" ||
        host.authType === "credential" ||
        host.authType === "agent"
      );
    // These cases document the extension point without enabling behavior.
    case "rdp":
    case "vnc":
    case "telnet":
      throw new Error(
        `${protocol.toUpperCase()} shared-host authentication is not implemented`,
      );
  }
}

/**
 * Applies the shared-host authentication precedence independently from any
 * transport: recipient override, explicitly shared owner auth, secretless
 * auth, then "required". Only SSH is currently enabled by callers.
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

  if (protocol === "ssh" && host.shareSshAuth) {
    if (host.authType === "agent") {
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
