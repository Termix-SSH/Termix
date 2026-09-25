import type {
  PluginContext,
  PluginSshAuthProvider,
} from "@termix/plugin-sdk/backend";
import {
  isTailscaleCheckCompleteBanner,
  parseTailscaleCheckBanner,
  TAILSCALE_CHECK_TIMEOUT_MS,
} from "./tailscale-check.js";

const AUTH_FAILED_PATTERN = /All configured authentication methods failed/i;

export const tailscaleSshAuthProvider: PluginSshAuthProvider = {
  type: "tailscale",
  labelKey: "hosts.filterAuthTailscale",
  // Nothing host-specific to look up, so it works for an unsaved host.
  quickConnect: true,
  connectOptions: (_host, purpose) =>
    purpose === "terminal"
      ? {
          tryKeyboard: false,
          readyTimeout: TAILSCALE_CHECK_TIMEOUT_MS,
          // The socket sits idle while a check-mode login is pending.
          timeout: TAILSCALE_CHECK_TIMEOUT_MS,
        }
      : { tryKeyboard: false },
  prepare: async (_config, _host, env) => {
    env.log("info", "Using Tailscale SSH");
    return { status: "ready" };
  },
  onBanner: (banner) => {
    const check = parseTailscaleCheckBanner(banner);
    if (check) {
      return {
        action: "hold",
        timeoutMs: TAILSCALE_CHECK_TIMEOUT_MS,
        message: `Tailscale SSH requires an additional check. Waiting for browser authentication at ${check.url}`,
        details: { url: check.url, message: check.message },
      };
    }
    if (isTailscaleCheckCompleteBanner(banner)) {
      return { action: "release" };
    }
    return undefined;
  },
  onAuthFailed: (host, _env, context) => {
    const failed =
      context.methodNotAvailable ||
      AUTH_FAILED_PATTERN.test(context.error.message);
    if (!failed) return;

    // Tailscale documents the "+password" suffix for clients that mishandle a
    // successful "none" reply. The password value is ignored.
    if (context.retries === 0 && context.canRetry) {
      return {
        status: "retry",
        message: "Retrying Tailscale SSH in forced password mode",
        patch: {
          username: `${host.username}+password`,
          password: "termix",
          tryKeyboard: false,
        },
      };
    }

    return {
      status: "error",
      code: "failed",
      message: `Tailscale SSH authentication failed for user "${host.username}". Ensure Tailscale is running on the server, SSH is advertised (tailscale set --ssh), and your ACL policy grants the "${host.username}" user to your identity. If your Tailscale identity maps to a different Unix user, update the username on this host.`,
    };
  },
};

export function registerTailscaleSshAuth(ctx: PluginContext): void {
  ctx.auth.registerSshAuthProvider(tailscaleSshAuthProvider);
}
