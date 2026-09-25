/**
 * Auth methods that still live in core for 2.9.0, registered through the same
 * interfaces a plugin uses. Phase C moves each one into its own plugin by
 * relocating its block from here; D1 deletes this file once it is empty.
 *
 * Nothing outside this file should branch on these type names.
 */

import { getErrorMessage } from "../utils/error-message.js";
import { sshLogger } from "../utils/logger.js";
import { applyCertificateAuth } from "@termix/plugin-sdk/ssh-certs";
import { registerSshAuthProvider } from "../hosts/connect/auth-provider-registry.js";
import type {
  SshAuthProvider,
  SshConnectHost,
} from "../hosts/connect/types.js";

const STEPCA_REQUIRED_MESSAGE =
  "Step CA authentication required. Please open a Terminal connection to this host first to complete browser-based authentication.";

const VAULT_REQUIRED_MESSAGE =
  "Vault SSH signer authentication required. Please open a Terminal connection first.";

const AUTH_FAILED_PATTERN = /All configured authentication methods failed/i;

const stepCaProvider: SshAuthProvider = {
  type: "stepca",
  pluginId: "core",
  labelKey: "hosts.filterAuthStepca",
  needsUserInteraction: true,
  supportsBackground: false,
  interaction: "stepca",
  prepare: async (config, host, env) => {
    const { getStepCaCert } = await import("../hosts/step-ca-auth.js");
    const cert = getStepCaCert(env.userId, env.hostId);
    if (!cert) {
      env.log("info", "No valid certificate found, requesting sign-in");
      return {
        status: "interaction-required",
        interaction: "stepca",
        message: STEPCA_REQUIRED_MESSAGE,
      };
    }
    try {
      await applyCertificateAuth(
        config,
        env.client,
        { privateKey: cert.privateKey, certificate: cert.sshCert },
        host.username,
      );
    } catch (error) {
      return {
        status: "error",
        code: "failed",
        message: "Step CA authentication failed: " + getErrorMessage(error),
      };
    }
    env.log("info", "Using cached SSH certificate");
    return { status: "ready" };
  },
  onAuthFailed: (_host, env, context) => {
    if (!AUTH_FAILED_PATTERN.test(context.error.message)) return;
    void import("../hosts/step-ca-auth.js")
      .then(({ invalidateStepCaCert }) =>
        invalidateStepCaCert(env.userId, env.hostId),
      )
      .catch(() => {});
    return {
      status: "interaction-required",
      interaction: "stepca",
      message:
        "Step CA authentication failed or expired. Please authenticate again.",
    };
  },
  startInteraction: async (request) => {
    const { startStepCaAuth } = await import("../hosts/step-ca-auth.js");
    await startStepCaAuth(
      request.userId,
      request.hostId,
      request.host.username,
      request.socket,
      request.requestOrigin,
    );
  },
  cancelInteraction: async (request) => {
    if (!request.requestId) return;
    const { cancelStepCaAuth } = await import("../hosts/step-ca-auth.js");
    cancelStepCaAuth(request.requestId);
  },
};

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
      await applyCertificateAuth(
        config,
        env.client,
        { privateKey: cert.privateKey, certificate: cert.sshCert },
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

let sshRegistered = false;

export function registerLegacySshAuthProviders(): void {
  if (sshRegistered) return;
  sshRegistered = true;

  registerSshAuthProvider(stepCaProvider);
  registerSshAuthProvider(vaultProvider);
}

/** Test helper. */
export function resetLegacyProvidersForTests(): void {
  sshRegistered = false;
}
