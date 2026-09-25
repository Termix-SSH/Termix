import type {
  PluginContext,
  PluginSshAuthProvider,
} from "@termix/plugin-sdk/backend";
import { applyCertificateAuth } from "@termix/plugin-sdk/ssh-certs";
import type { AuthSessions, SignInSocket } from "./auth-session.js";
import type { CertStore } from "./cert-store.js";

export const AUTH_TYPE = "stepca";

const REQUIRED_MESSAGE =
  "Step CA authentication required. Please open a Terminal connection to this host first to complete browser-based authentication.";

const AUTH_FAILED_PATTERN = /All configured authentication methods failed/i;

/**
 * Hosts with auth type "stepca" connect with the certificate the CA issued.
 * Without one, the terminal is asked for a browser sign-in
 * ("stepca_auth_required"), which startInteraction runs.
 */
export function createStepCaProvider(
  ctx: PluginContext,
  certs: CertStore,
  sessions: AuthSessions,
): PluginSshAuthProvider {
  return {
    type: AUTH_TYPE,
    labelKey: "hosts.filterAuthStepca",
    needsUserInteraction: true,
    supportsBackground: false,
    interaction: AUTH_TYPE,
    prepare: async (config, host, env) => {
      const certificate = await certs.get(env.userId, env.hostId);
      if (!certificate) {
        env.log("info", "No valid certificate found, requesting sign-in");
        return {
          status: "interaction-required",
          interaction: AUTH_TYPE,
          message: REQUIRED_MESSAGE,
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
            "Step CA authentication failed: " +
            (error instanceof Error ? error.message : String(error)),
        };
      }
      env.log("info", "Using cached SSH certificate");
      return { status: "ready" };
    },
    onAuthFailed: (_host, env, context) => {
      if (!AUTH_FAILED_PATTERN.test(context.error.message)) return undefined;
      ctx.log.warn("Step CA authentication failed, forgetting the certificate");
      void certs.remove(env.userId, env.hostId).catch(() => undefined);
      return {
        status: "interaction-required",
        interaction: AUTH_TYPE,
        message:
          "Step CA authentication failed or expired. Please authenticate again.",
      };
    },
    startInteraction: async (request) => {
      await sessions.start({
        userId: request.userId,
        hostId: request.hostId,
        username: request.host.username,
        socket: request.socket as SignInSocket,
        requestOrigin: request.requestOrigin,
      });
    },
    cancelInteraction: async (request) => {
      if (request.requestId) sessions.cancel(request.requestId);
    },
  };
}
