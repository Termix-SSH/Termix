/**
 * ctx.credentials: plaintext protocol credentials for a host, for a plugin
 * that hands them to a program core does not run (remote desktop gives them
 * to guacd). Needs credentials:read, the one critical capability, and every
 * call is audited whether it succeeds or not.
 *
 * The protocol credentials themselves stay in core, next to the host, because
 * core's sharing model (per-recipient secret snapshots, personal overrides)
 * is what decides which ones a shared recipient may use.
 *
 * registerSecretResolver is the other half: a plugin that resolves
 * "<scheme>://..." references in a host's secret fields (secret-sources and
 * "op://") instead of handing over a host's own stored secret. Needs
 * auth:provide, like ctx.auth's registrations, and the scheme must be listed
 * in contributes.auth.secretSchemes.
 *
 * listSshKeys and createSshKey reach the acting user's own saved keys: the
 * public half only (credentials:use), and saving a new key pair
 * (credentials:write). Termix Identity publishes and generates keys this way.
 */

import type {
  PluginCredentials,
  PluginHostProtocol,
  PluginProtocolTarget,
  PluginSshKeyCredential,
} from "@termix/plugin-sdk/backend";
import ssh2 from "ssh2";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { assertCapability, capabilityRefused } from "./permissions.js";
import { getActor } from "./actor.js";
import type { DisposableBag } from "./disposables.js";
import { registerSecretResolver } from "../hosts/connect/secret-resolver-registry.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
  bag: DisposableBag;
  audit: AuditFn;
}

const PROTOCOLS: PluginHostProtocol[] = ["rdp", "vnc", "telnet"];

type HostRow = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseJumpHosts(value: unknown): Array<{ hostId: number }> {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((hop) => Number((hop as { hostId?: unknown })?.hostId))
    .filter((id) => Number.isInteger(id) && id > 0)
    .map((hostId) => ({ hostId }));
}

async function resolveOwnerAuth(
  host: HostRow,
  protocol: PluginHostProtocol,
): Promise<PluginProtocolTarget["auth"]> {
  const credentialId = host[`${protocol}CredentialId`] as number | null;
  const authType =
    str(host[`${protocol}AuthType`]) ||
    (credentialId ? "credential" : "direct");
  let username = str(host[`${protocol}User`]);
  let password = str(host[`${protocol}Password`]);

  if (authType === "credential" && credentialId) {
    const { createCurrentHostResolutionRepository } =
      await import("../database/repositories/factory.js");
    const credential =
      await createCurrentHostResolutionRepository().findCredentialByIdForUser(
        credentialId,
        host.userId as string,
      );
    // The domain never comes from a stored credential.
    if (credential?.username) username = credential.username;
    if (credential?.password) password = credential.password;
  }

  if (protocol === "rdp") username ||= str(host.username);
  password ||= str(host.password);

  return {
    authType,
    username,
    password,
    domain: str(host.rdpDomain) || str(host.domain),
  };
}

async function resolveRecipientAuth(
  host: HostRow,
  hostId: number,
  userId: string,
  protocol: PluginHostProtocol,
): Promise<PluginProtocolTarget["auth"]> {
  const { resolveRecipientSharedHostAuthentication } =
    await import("../utils/shared-host-auth-resolver.js");
  // Recipients never read the owner's raw secrets, so start from nothing.
  const recipientHost = {
    ...host,
    password: null,
    rdpUser: null,
    rdpPassword: null,
    vncUser: null,
    vncPassword: null,
    telnetUser: null,
    telnetPassword: null,
  };
  let resolution: Awaited<
    ReturnType<typeof resolveRecipientSharedHostAuthentication>
  >;
  try {
    resolution = await resolveRecipientSharedHostAuthentication(
      recipientHost as never,
      hostId,
      userId,
      protocol,
    );
  } catch {
    // Same as before the move: connect without stored credentials.
    resolution = { source: "required" };
  }

  const auth =
    resolution.source === "personal-override"
      ? { ...resolution.credential, domain: null }
      : resolution.source === "owner-shared"
        ? resolution.secret
        : null;

  let authType = "direct";
  if (resolution.source === "personal-override") authType = "credential";
  else if (resolution.source === "owner-shared") authType = resolution.authType;
  else if (
    resolution.source === "secretless" &&
    str(host[`${protocol}AuthType`]) === "none"
  ) {
    authType = "none";
  }

  return {
    authType,
    username: str(auth?.username),
    password: str(auth?.password),
    domain: str(auth?.domain) || str(host.rdpDomain) || str(host.domain),
  };
}

function derivePublicKey(
  privateKey: string | null | undefined,
  passphrase: string | null | undefined,
): string | null {
  if (!privateKey) return null;
  try {
    const parsed = ssh2.utils.parseKey(privateKey, passphrase || undefined);
    const key = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!key || key instanceof Error) return null;
    return `${key.type} ${key.getPublicSSH().toString("base64")}`;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireCorePermission(
  userId: string,
  permission: string,
): Promise<void> {
  const { PermissionManager } = await import("../utils/permission-manager.js");
  if (
    !(await PermissionManager.getInstance().hasPermission(userId, permission))
  ) {
    throw new Error(`The acting user lacks ${permission}`);
  }
}

function actingUser(): string {
  const userId = getActor();
  if (!userId) {
    throw new Error(
      "ctx.credentials needs an acting user: call it inside a request or ctx.asUser",
    );
  }
  return userId;
}

export function createPluginCredentials({
  manifest,
  bag,
  audit,
}: Deps): PluginCredentials {
  const pluginId = manifest.id;
  const declared = manifest.capabilities;

  return {
    listSshKeys: async () => {
      try {
        await assertCapability(pluginId, "credentials:use", declared);
        const userId = actingUser();
        await requireCorePermission(userId, "credentials.view");
        const { createCurrentCredentialRepository } =
          await import("../database/repositories/factory.js");
        const rows =
          await createCurrentCredentialRepository().listDecryptedByUserId(
            userId,
          );
        const keys: PluginSshKeyCredential[] = rows
          .filter((row) => row.authType === "key")
          .map((row) => ({
            id: row.id,
            name: row.name,
            username: row.username ?? null,
            publicKey:
              (typeof row.publicKey === "string" && row.publicKey.trim()) ||
              derivePublicKey(row.privateKey || row.key, row.keyPassword),
          }));
        await audit("credentials_list_keys", `${keys.length} keys`, {
          success: true,
        });
        return keys;
      } catch (error) {
        await audit("credentials_list_keys", "saved SSH keys", {
          success: false,
          errorMessage: errorText(error),
        });
        throw error;
      }
    },

    createSshKey: async (input) => {
      const details = `SSH key "${input?.name ?? ""}"`;
      try {
        await assertCapability(pluginId, "credentials:write", declared);
        const userId = actingUser();
        await requireCorePermission(userId, "credentials.create");
        if (!input?.name || !input.privateKey || !input.publicKey) {
          throw new Error("name, privateKey and publicKey are required");
        }
        const { createCurrentCredentialRepository } =
          await import("../database/repositories/factory.js");
        const created =
          await createCurrentCredentialRepository().createEncryptedForUser(
            userId,
            {
              userId,
              name: input.name,
              description: input.description ?? null,
              folder: null,
              tags: "",
              authType: "key",
              username: input.username || null,
              password: null,
              key: input.privateKey,
              privateKey: input.privateKey,
              publicKey: input.publicKey,
              keyPassword: null,
              keyType: null,
              detectedKeyType: input.keyType,
              usageCount: 0,
              lastUsed: null,
            },
          );
        await audit("credentials_create_key", details, { success: true });
        return { id: created.id };
      } catch (error) {
        await audit("credentials_create_key", details, {
          success: false,
          errorMessage: errorText(error),
        });
        throw error;
      }
    },

    registerSecretResolver: (scheme, resolve) => {
      if (!declared.includes("auth:provide")) {
        throw capabilityRefused(pluginId, "auth:provide");
      }
      if (!manifest.contributes?.auth?.secretSchemes?.includes(scheme)) {
        throw new Error(
          `Plugin ${pluginId} cannot register secret scheme "${scheme}": it is not listed in contributes.auth.secretSchemes`,
        );
      }
      const dispose = registerSecretResolver(
        scheme,
        { pluginId, pluginName: manifest.name },
        async (userId, reference) => {
          await assertCapability(pluginId, "auth:provide", declared);
          const details = `secret reference for ${userId}`;
          try {
            const value = await resolve(userId, reference);
            await audit("secret_resolve", details, { success: true });
            return value;
          } catch (error) {
            await audit("secret_resolve", details, {
              success: false,
              errorMessage:
                error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
      );
      bag.add(dispose, `secret scheme "${scheme}"`);
    },

    resolveHostProtocol: async (hostId, protocol) => {
      const details = `${protocol} credentials for host ${hostId}`;
      try {
        await assertCapability(pluginId, "credentials:read", declared);
        if (!PROTOCOLS.includes(protocol)) {
          throw new Error(`Unsupported protocol: ${String(protocol)}`);
        }
      } catch (error) {
        await audit("credentials_read", details, {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      const userId = getActor();
      if (!userId) {
        throw new Error(
          "ctx.credentials needs an acting user: call it inside a request or ctx.asUser",
        );
      }

      const { createCurrentHostResolutionRepository } =
        await import("../database/repositories/factory.js");
      const repository = createCurrentHostResolutionRepository();
      // Shared hosts carry fields encrypted under the owner's key.
      const ownerId = await repository.findHostOwnerId(hostId);
      const host = ownerId
        ? ((await repository.findHostById(hostId, ownerId)) as HostRow | null)
        : null;
      if (!host) {
        await audit("credentials_read", details, {
          success: false,
          errorMessage: "Host not found",
        });
        return null;
      }

      const shared = host.userId !== userId;
      if (shared) {
        const { PermissionManager } =
          await import("../utils/permission-manager.js");
        const access = await PermissionManager.getInstance().canAccessHost(
          userId,
          hostId,
          "connect",
        );
        if (!access.hasAccess) {
          await audit("credentials_read", details, {
            success: false,
            errorMessage: "No connect access",
          });
          return null;
        }
      }

      const auth = shared
        ? await resolveRecipientAuth(host, hostId, userId, protocol)
        : await resolveOwnerAuth(host, protocol);

      await audit("credentials_read", details, { success: true });
      return {
        host: {
          id: hostId,
          name: (host.name as string | null) ?? null,
          ip: str(host.ip),
          port: Number(host.port) || 0,
          ownerUserId: host.userId as string,
          jumpHosts: parseJumpHosts(host.jumpHosts),
        },
        shared,
        auth,
      };
    },
  };
}
