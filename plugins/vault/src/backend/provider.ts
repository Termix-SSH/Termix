import type {
  PluginContext,
  PluginSshAuthProvider,
  PluginSshHost,
} from "@termix/plugin-sdk/backend";
import { applyCertificateAuth } from "@termix/plugin-sdk/ssh-certs";
import type { AuthSessions, SignInSocket } from "./auth-session.js";
import {
  toConfig,
  type ProfileRow,
  type ProfileStore,
} from "./profile-store.js";
import type { TokenStore } from "./token-store.js";

export const AUTH_TYPE = "vault";

const REQUIRED_MESSAGE =
  "Vault SSH signer authentication required. Please open a Terminal connection first.";

const AUTH_FAILED_PATTERN = /All configured authentication methods failed/i;

/** The profile a host points at, from its host settings. */
export async function profileForHost(
  ctx: PluginContext,
  profiles: ProfileStore,
  hostId: number,
): Promise<ProfileRow | null> {
  const raw = await ctx.settings.getHost<number | string>(hostId, "profileId");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return profiles.findById(id);
}

/**
 * Hosts with auth type "vault" connect with a certificate Vault signed for
 * the host's profile. Without one, the terminal is asked for a browser
 * sign-in ("vault_auth_required"), which startInteraction runs.
 */
export function createVaultProvider(
  ctx: PluginContext,
  profiles: ProfileStore,
  tokens: TokenStore,
  sessions: AuthSessions,
): PluginSshAuthProvider {
  return {
    type: AUTH_TYPE,
    labelKey: "hosts.filterAuthVault",
    needsUserInteraction: true,
    supportsBackground: false,
    interaction: AUTH_TYPE,
    prepare: async (config, host: PluginSshHost, env) => {
      const profile = await profileForHost(ctx, profiles, host.id);
      if (!profile) {
        return {
          status: "error",
          code: "failed",
          message: "Host has no Vault signer profile configured",
        };
      }
      const cert = await tokens.get(env.userId, profile.id);
      if (!cert) {
        env.log(
          "info",
          "No valid Vault certificate found, requesting authentication",
        );
        return {
          status: "interaction-required",
          interaction: AUTH_TYPE,
          message: REQUIRED_MESSAGE,
          flag: "requiresVaultAuth",
        };
      }
      try {
        await applyCertificateAuth(
          config as never,
          env.client as never,
          { privateKey: cert.privateKey, certificate: cert.sshCert },
          host.username,
        );
      } catch (error) {
        return {
          status: "error",
          code: "failed",
          message:
            "Vault SSH signer authentication failed: " +
            (error instanceof Error ? error.message : String(error)),
        };
      }
      env.log("info", "Using cached Vault-signed certificate");
      return { status: "ready" };
    },
    onAuthFailed: (host, env, context) => {
      if (!AUTH_FAILED_PATTERN.test(context.error.message)) return undefined;
      ctx.log.warn("Vault certificate authentication failed, forgetting it");
      void profileForHost(ctx, profiles, host.id)
        .then((profile) =>
          profile ? tokens.remove(env.userId, profile.id) : undefined,
        )
        .catch(() => undefined);
      return {
        status: "interaction-required",
        interaction: AUTH_TYPE,
        message:
          "Vault authentication failed or expired. Please authenticate again.",
      };
    },
    startInteraction: async (request) => {
      const profile = await profileForHost(ctx, profiles, request.hostId);
      if (!profile) {
        throw new Error("No Vault signer profile configured for this host");
      }
      await sessions.start({
        userId: request.userId,
        hostId: request.hostId,
        profile: toConfig(profile),
        socket: request.socket as SignInSocket,
        requestOrigin: request.requestOrigin,
      });
    },
    cancelInteraction: (request) => {
      sessions.cancel(request.userId, request.hostId, request.requestId);
    },
  };
}
