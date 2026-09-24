/**
 * Auth methods that still live in core for 2.9.0, registered through the same
 * interfaces a plugin uses. Phase C moves each one into its own plugin by
 * relocating its block from here; D1 deletes this file once it is empty.
 *
 * Nothing outside this file should branch on these type names.
 */

import { getErrorMessage } from "../utils/error-message.js";
import { sshLogger } from "../utils/logger.js";
import {
  registerKeyboardInteractiveInterceptor,
  registerSshAuthProvider,
} from "../hosts/connect/auth-provider-registry.js";
import type {
  SshAuthProvider,
  SshConnectHost,
} from "../hosts/connect/types.js";

const OPKSSH_REQUIRED_MESSAGE =
  "OPKSSH authentication required. Please open a Terminal connection to this host first to complete browser-based authentication. Your session will be cached for 24 hours.";

const VAULT_REQUIRED_MESSAGE =
  "Vault SSH signer authentication required. Please open a Terminal connection first.";

const AUTH_FAILED_PATTERN = /All configured authentication methods failed/i;

function issuedCertificateProvider(
  type: "opkssh" | "stepca",
  labelKey: string,
): SshAuthProvider {
  return {
    type,
    pluginId: "core",
    labelKey,
    needsUserInteraction: true,
    supportsBackground: false,
    interaction: "opkssh",
    prepare: async (config, host, env) => {
      const { getOPKSSHToken } = await import("../hosts/opkssh-auth.js");
      const token = await getOPKSSHToken(env.userId, env.hostId);
      if (!token) {
        env.log("info", "No valid certificate found, requesting sign-in");
        return {
          status: "interaction-required",
          interaction: "opkssh",
          message: OPKSSH_REQUIRED_MESSAGE,
          flag: "requiresOPKSSHAuth",
        };
      }
      try {
        const { setupOPKSSHCertAuth } =
          await import("../hosts/opkssh-cert-auth.js");
        await setupOPKSSHCertAuth(config, env.client, token, host.username);
      } catch (error) {
        return {
          status: "error",
          code: "failed",
          message: "OPKSSH authentication failed: " + getErrorMessage(error),
        };
      }
      env.log("info", "Using cached SSH certificate");
      return { status: "ready" };
    },
    onAuthFailed: (_host, env, context) => {
      if (!AUTH_FAILED_PATTERN.test(context.error.message)) return;
      sshLogger.warn("OPKSSH authentication failed - invalidating token", {
        operation: "opkssh_auth_failed",
        hostId: env.hostId,
        userId: env.userId,
      });
      void import("../hosts/opkssh-auth.js")
        .then(({ invalidateOPKSSHToken }) =>
          invalidateOPKSSHToken(env.userId, env.hostId, "SSH auth failed"),
        )
        .catch(() => {});
      return {
        status: "interaction-required",
        interaction: "opkssh",
        message:
          "OPKSSH authentication failed or expired. Please authenticate again.",
      };
    },
    startInteraction: async (request) => {
      if (type === "stepca") {
        const { startStepCaAuth } = await import("../hosts/step-ca-auth.js");
        await startStepCaAuth(
          request.userId,
          request.hostId,
          request.host.username,
          request.socket,
          request.requestOrigin,
        );
        return;
      }
      const { startOPKSSHAuth } = await import("../hosts/opkssh-auth.js");
      await startOPKSSHAuth(
        request.userId,
        request.hostId,
        request.host.name || request.host.ip,
        request.socket,
        request.requestOrigin,
      );
    },
    cancelInteraction: async (request) => {
      if (!request.requestId) return;
      if (type === "stepca") {
        const { cancelStepCaAuth } = await import("../hosts/step-ca-auth.js");
        cancelStepCaAuth(request.requestId);
        return;
      }
      const { cancelAuthSession } = await import("../hosts/opkssh-auth.js");
      cancelAuthSession(request.requestId);
    },
  };
}

function vaultProfileId(host: SshConnectHost): number | undefined {
  return host.vaultProfile?.id ?? undefined;
}

const vaultProvider: SshAuthProvider = {
  type: "vault",
  pluginId: "core",
  labelKey: "hosts.filterAuthVault",
  needsUserInteraction: true,
  interaction: "vault",
  prepare: async (config, host, env) => {
    const profileId = vaultProfileId(host);
    if (!profileId) {
      return {
        status: "error",
        code: "failed",
        message: "Host has no Vault signer profile configured",
      };
    }
    const { getVaultCert } = await import("../hosts/vault-signer-auth.js");
    const cert = await getVaultCert(env.userId, profileId);
    if (!cert) {
      env.log(
        "info",
        "No valid Vault certificate found, requesting authentication",
      );
      return {
        status: "interaction-required",
        interaction: "vault",
        message: VAULT_REQUIRED_MESSAGE,
        flag: "requiresVaultAuth",
      };
    }
    try {
      const { setupOPKSSHCertAuth } =
        await import("../hosts/opkssh-cert-auth.js");
      await setupOPKSSHCertAuth(
        config,
        env.client,
        { privateKey: cert.privateKey, sshCert: cert.sshCert },
        host.username,
      );
    } catch (error) {
      return {
        status: "error",
        code: "failed",
        message:
          "Vault SSH signer authentication failed: " + getErrorMessage(error),
      };
    }
    env.log("info", "Using cached Vault-signed certificate");
    return { status: "ready" };
  },
  onAuthFailed: (host, env, context) => {
    if (!AUTH_FAILED_PATTERN.test(context.error.message)) return;
    sshLogger.warn("Vault certificate authentication failed", {
      operation: "vault_auth_failed",
      hostId: env.hostId,
      userId: env.userId,
    });
    const profileId = vaultProfileId(host);
    if (profileId) {
      void import("../hosts/vault-signer-auth.js")
        .then(({ deleteVaultCert }) => deleteVaultCert(env.userId, profileId))
        .catch(() => {});
    }
    return {
      status: "interaction-required",
      interaction: "vault",
      message:
        "Vault authentication failed or expired. Please authenticate again.",
    };
  },
  startInteraction: async (request) => {
    const { loadVaultProfileForHost, startVaultAuth } =
      await import("../hosts/vault-oidc-auth.js");
    const profile = await loadVaultProfileForHost(
      request.hostId,
      request.userId,
    );
    if (!profile) {
      throw new Error("No Vault signer profile configured for this host");
    }
    await startVaultAuth(
      request.userId,
      request.hostId,
      profile,
      request.socket,
      request.requestOrigin,
    );
  },
  cancelInteraction: async (request) => {
    if (request.hostId === undefined) return;
    const { cancelVaultAuthByHost } =
      await import("../hosts/vault-oidc-auth.js");
    cancelVaultAuthByHost(request.userId, request.hostId);
  },
};

const WARPGATE_PATTERN = /warpgate\s+authentication/i;

let sshRegistered = false;

export function registerLegacySshAuthProviders(): void {
  if (sshRegistered) return;
  sshRegistered = true;

  registerSshAuthProvider(
    issuedCertificateProvider("opkssh", "hosts.filterAuthOpkssh"),
  );
  registerSshAuthProvider(
    issuedCertificateProvider("stepca", "hosts.filterAuthStepca"),
  );
  registerSshAuthProvider(vaultProvider);

  // Warpgate is a flag on a host, not an auth type: it shows up as a
  // keyboard-interactive round with a sign-in URL.
  registerKeyboardInteractiveInterceptor({
    id: "warpgate",
    pluginId: "core",
    detect: ({ name, instructions, prompts }) => {
      const texts = prompts.map((p) => p.prompt);
      const isWarpgate =
        WARPGATE_PATTERN.test(name) ||
        WARPGATE_PATTERN.test(instructions) ||
        texts.some((p) => WARPGATE_PATTERN.test(p));
      if (!isWarpgate) return null;

      const fullText = `${name}\n${instructions}\n${texts.join("\n")}`;
      const urlMatch = fullText.match(/https?:\/\/[^\s\n]+/i);
      if (!urlMatch) return null;
      const keyMatch = fullText.match(
        /security key[:\s]+([a-z0-9](?:\s+[a-z0-9]){3}|[a-z0-9]{4})/i,
      );
      return {
        kind: "warpgate",
        url: urlMatch[0],
        securityKey: keyMatch ? keyMatch[1] : "N/A",
        instructions,
      };
    },
    // Warpgate asks for the password before its browser round; answer it
    // silently so the only thing the user sees is the Warpgate dialog.
    autoAnswerPasswords: (host) => host.useWarpgate === true,
  });
}

/** Test helper. */
export function resetLegacyProvidersForTests(): void {
  sshRegistered = false;
}
