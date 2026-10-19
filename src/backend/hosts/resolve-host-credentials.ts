import { getErrorMessage } from "../utils/error-message.js";
import { sshLogger } from "../utils/logger.js";
import { findUsableCredential } from "./usable-credential.js";
import {
  pickResolvedPassword,
  pickResolvedUsername,
} from "./credential-username.js";
import { createCurrentSharedHostAuthOverrideRepository } from "../database/repositories/factory.js";
import { listHostProtocols } from "./protocol-auth/registry.js";
import {
  requiresPersonalHostAuthentication,
  resolveRecipientSharedHostAuthentication,
} from "../utils/shared-host-auth-resolver.js";
import type {
  HostResolutionCredentialRecord,
  HostResolutionHostRecord,
} from "../database/repositories/host-resolution-repository.js";

/** A host with its credential's secrets filled in for the asking user. */
export async function resolveHostCredentials(
  host: Record<string, unknown>,
  requestingUserId?: string,
  /**
   * Credentials already fetched for this request, keyed by id. The host list
   * preloads them in one query; single-host callers omit it and fall back to
   * fetching the one credential they need.
   */
  preloadedCredentials?: Map<number, HostResolutionCredentialRecord>,
): Promise<Record<string, unknown>> {
  try {
    const ownerId = (host.ownerId || host.userId) as string | undefined;
    if (
      requestingUserId &&
      ownerId &&
      requestingUserId !== ownerId &&
      typeof host.id === "number"
    ) {
      const authHost = host as unknown as HostResolutionHostRecord;
      const needsPersonalCredential = requiresPersonalHostAuthentication(
        authHost,
        "ssh",
      );
      const baseSshOverrideState = {
        required: needsPersonalCredential,
        ownerAuthShared: !!host.shareSshAuth,
      };
      // Owner auth for the remote desktop protocols is always snapshotted
      // for recipients; only their own override credential varies per user.
      const authOverrides: Record<string, unknown> = {
        ssh: baseSshOverrideState,
      };
      const overrideCredentialIds =
        await createCurrentSharedHostAuthOverrideRepository().listCredentialIds(
          host.id,
          requestingUserId,
        );
      // Whether a plugin protocol is on is its plugin's host setting; the
      // client only offers an override for one that is.
      for (const { id: protocol } of listHostProtocols()) {
        authOverrides[protocol] = {
          credentialId: overrideCredentialIds[protocol],
          required: false,
          ownerAuthShared: true,
        };
      }
      const recipientHost: Record<string, unknown> = {
        ...host,
        credentialId: null,
        password: null,
        key: null,
        keyPassword: null,
        keyType: null,
        authOverrides,
      };

      try {
        const resolution = await resolveRecipientSharedHostAuthentication(
          authHost,
          host.id,
          requestingUserId,
          "ssh",
        );

        if (resolution.source === "personal-override") {
          const credential = resolution.credential;
          return {
            ...recipientHost,
            authOverrides: {
              ...authOverrides,
              ssh: {
                credentialId: resolution.credentialId,
                required: false,
                ownerAuthShared: !!host.shareSshAuth,
              },
            },
            authType:
              credential.key || credential.privateKey
                ? "key"
                : credential.password
                  ? "password"
                  : "none",
            username: credential.username || recipientHost.username,
            password: credential.password,
            key: credential.privateKey || credential.key,
            keyPassword: credential.keyPassword,
            keyType: credential.keyType,
          };
        }

        if (resolution.source === "owner-shared") {
          if (resolution.authType === "agent") {
            return {
              ...recipientHost,
              authOverrides: {
                ...authOverrides,
                ssh: {
                  required: false,
                  ownerAuthShared: true,
                },
              },
              authType: "agent",
            };
          }

          const sharedAuth = resolution.secret;
          if (sharedAuth) {
            const resolvedUsername = pickResolvedUsername(
              recipientHost.username,
              sharedAuth.username,
              host.overrideCredentialUsername,
            );
            return {
              ...recipientHost,
              authOverrides: {
                ...authOverrides,
                ssh: {
                  required: false,
                  ownerAuthShared: true,
                },
              },
              authType: sharedAuth.key
                ? "key"
                : sharedAuth.password
                  ? "password"
                  : "none",
              username: resolvedUsername,
              password: sharedAuth.password,
              key: sharedAuth.key,
              keyPassword: sharedAuth.keyPassword,
              keyType: sharedAuth.keyType,
            };
          }
        }

        if (resolution.source === "secretless") {
          return {
            ...recipientHost,
            authOverrides: {
              ...authOverrides,
              ssh: {
                required: false,
                ownerAuthShared: !!host.shareSshAuth,
              },
            },
          };
        }
      } catch {
        // A missing/deleted override or snapshot behaves like unavailable auth.
      }

      return recipientHost;
    }

    if (host.credentialId && (host.userId || host.ownerId)) {
      const credentialId = host.credentialId as number;
      const credentialOwnerId = (host.ownerId || host.userId) as string;

      const credential =
        preloadedCredentials?.get(credentialId) ??
        (await findUsableCredential(credentialId, credentialOwnerId));

      if (credential) {
        const resolvedHost: Record<string, unknown> = {
          ...host,
          password: pickResolvedPassword(host.password, credential.password),
          key: credential.key,
          keyPassword: credential.keyPassword,
          keyType: credential.keyType,
        };

        const resolvedUsername = pickResolvedUsername(
          host.username,
          credential.username,
          host.overrideCredentialUsername,
        );
        if (resolvedUsername !== undefined) {
          resolvedHost.username = resolvedUsername;
        }

        return resolvedHost;
      }
    }

    return { ...host };
  } catch (error) {
    sshLogger.warn(
      `Failed to resolve credentials for host ${host.id}: ${getErrorMessage(error)}`,
    );
    return host;
  }
}
