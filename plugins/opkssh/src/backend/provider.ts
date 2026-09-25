import type {
  PluginContext,
  PluginSshAuthProvider,
} from "@termix/plugin-sdk/backend";
import { applyCertificateAuth } from "@termix/plugin-sdk/ssh-certs";
import type { AuthSessions, SignInSocket } from "./auth-session.js";
import type { TokenStore } from "./token-store.js";

export const AUTH_TYPE = "opkssh";

const REQUIRED_MESSAGE =
  "OPKSSH authentication required. Please open a Terminal connection to this host first to complete browser-based authentication. Your session will be cached for 24 hours.";

const AUTH_FAILED_PATTERN = /All configured authentication methods failed/i;

/**
 * Hosts with auth type "opkssh" connect with a cached certificate. Without
 * one, the terminal is asked for a browser sign-in ("opkssh_auth_required"),
 * which startInteraction runs.
 */
export function createOpksshProvider(
  ctx: PluginContext,
  tokens: TokenStore,
  sessions: AuthSessions,
): PluginSshAuthProvider {
  return {
    type: AUTH_TYPE,
    labelKey: "hosts.filterAuthOpkssh",
    needsUserInteraction: true,
    supportsBackground: false,
    interaction: AUTH_TYPE,
    prepare: async (config, host, env) => {
      const certificate = await tokens.get(env.userId, env.hostId);
      if (!certificate) {
        env.log("info", "No valid certificate found, requesting sign-in");
        return {
          status: "interaction-required",
          interaction: AUTH_TYPE,
          message: REQUIRED_MESSAGE,
          flag: "requiresOPKSSHAuth",
        };
      }
      try {
        await applyCertificateAuth(
          config as never,
          env.client as never,
          {
            privateKey: certificate.privateKey,
            certificate: certificate.sshCert,
          },
          host.username,
        );
      } catch (error) {
        return {
          status: "error",
          code: "failed",
          message:
            "OPKSSH authentication failed: " +
            (error instanceof Error ? error.message : String(error)),
        };
      }
      env.log("info", "Using cached SSH certificate");
      return { status: "ready" };
    },
    onAuthFailed: (_host, env, context) => {
      if (!AUTH_FAILED_PATTERN.test(context.error.message)) return undefined;
      ctx.log.warn("OPKSSH authentication failed, forgetting the certificate");
      void tokens.remove(env.userId, env.hostId).catch(() => undefined);
      return {
        status: "interaction-required",
        interaction: AUTH_TYPE,
        message:
          "OPKSSH authentication failed or expired. Please authenticate again.",
      };
    },
    startInteraction: async (request) => {
      await sessions.start({
        userId: request.userId,
        hostId: request.hostId,
        socket: request.socket as SignInSocket,
        requestOrigin: request.requestOrigin,
      });
    },
    cancelInteraction: async (request) => {
      if (request.requestId) await sessions.cancel(request.requestId);
    },
  };
}
