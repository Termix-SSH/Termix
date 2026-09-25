/**
 * The SSH auth types core always provides: password, key, credential, agent
 * and none. Everything else is a plugin (or, in 2.9.0, a legacy provider).
 */

import ssh2 from "ssh2";
import { getErrorMessage } from "../../utils/error-message.js";
import {
  isPrivateKeyPassphraseError,
  preparePrivateKeyForSSH2,
} from "../../utils/ssh-key-utils.js";
import { applyAgentAuth } from "../terminal-auth-helpers.js";
import { registerSshAuthProvider } from "./auth-provider-registry.js";
import type {
  MutableConnectConfig,
  SshAuthEnv,
  SshAuthOutcome,
  SshAuthProvider,
  SshConnectHost,
} from "./types.js";

function keyText(key: SshConnectHost["key"]): string {
  if (!key) return "";
  return Buffer.isBuffer(key) ? key.toString("utf8") : key;
}

async function preparePassword(
  config: MutableConnectConfig,
  host: SshConnectHost,
  env: SshAuthEnv,
): Promise<SshAuthOutcome> {
  if (!host.password) {
    return {
      status: "error",
      code: "missing-secret",
      message: "Password authentication requested but no password provided",
    };
  }
  // Forced keyboard-interactive answers the password prompt from the same
  // value instead of offering it up front.
  if (!host.forceKeyboardInteractive) {
    config.password = host.password;
  }
  env.log("info", "Using password authentication");
  return { status: "ready" };
}

async function prepareKey(
  config: MutableConnectConfig,
  host: SshConnectHost,
  env: SshAuthEnv,
): Promise<SshAuthOutcome> {
  const key = keyText(host.key);
  if (!key.trim()) {
    return {
      status: "error",
      code: "missing-secret",
      message: "SSH key authentication requested but no key provided",
    };
  }

  const passphrase = host.keyPassword || undefined;
  try {
    config.privateKey = preparePrivateKeyForSSH2(key, passphrase);
  } catch (error) {
    if (isPrivateKeyPassphraseError(error)) {
      return {
        status: "error",
        code: "passphrase-required",
        message:
          "The SSH key is encrypted. Please enter the passphrase to unlock it.",
      };
    }
    return {
      status: "error",
      code: "invalid-key",
      message: `SSH key format error: ${getErrorMessage(error, "Invalid private key format")}`,
    };
  }

  // A key that parses in our own helper can still be encrypted with no
  // passphrase given; ssh2 only notices at connect time otherwise.
  const parsed = ssh2.utils.parseKey(config.privateKey as Buffer, passphrase);
  if (parsed instanceof Error) {
    if (isPrivateKeyPassphraseError(parsed)) {
      return {
        status: "error",
        code: "passphrase-required",
        message:
          "The SSH key is encrypted. Please enter the passphrase to unlock it.",
      };
    }
    return {
      status: "error",
      code: "invalid-key",
      message: `SSH key format error: ${parsed.message}`,
    };
  }

  if (passphrase) config.passphrase = passphrase;
  // Lets a server that wants key then password (or password only) still work.
  if (host.password) config.password = host.password;

  const certPublicKey = host.certPublicKey;
  if (certPublicKey && certPublicKey.trim()) {
    try {
      const { applyCertificateAuth } =
        await import("@termix/plugin-sdk/ssh-certs");
      await applyCertificateAuth(
        config,
        env.client,
        {
          privateKey: config.privateKey as Buffer,
          certificate: certPublicKey,
          passphrase,
        },
        host.username,
      );
      env.log("info", "Using SSH key authentication with CA certificate");
      return { status: "ready" };
    } catch (certError) {
      env.log(
        "warning",
        `CA certificate setup failed, falling back to key only: ${getErrorMessage(certError)}`,
      );
    }
  }

  env.log("info", "Using SSH key authentication");
  return { status: "ready" };
}

export const passwordProvider: SshAuthProvider = {
  type: "password",
  pluginId: "core",
  labelKey: "hosts.filterAuthPassword",
  credentialType: true,
  requiresSecret: true,
  prepare: preparePassword,
};

export const keyProvider: SshAuthProvider = {
  type: "key",
  pluginId: "core",
  labelKey: "hosts.filterAuthKey",
  credentialType: true,
  requiresSecret: true,
  prepare: prepareKey,
};

/**
 * The resolver expands a credential into key or password before connect, so
 * this only runs when that expansion found something odd, like an unresolved
 * reference. It behaves like whichever secret is present.
 */
export const credentialProvider: SshAuthProvider = {
  type: "credential",
  pluginId: "core",
  labelKey: "hosts.filterAuthCredential",
  requiresSecret: true,
  prepare: async (config, host, env) => {
    if (keyText(host.key).trim()) return prepareKey(config, host, env);
    if (host.password) return preparePassword(config, host, env);
    return {
      status: "error",
      code: "missing-secret",
      message: "The stored credential for this host could not be resolved",
    };
  },
};

export const agentProvider: SshAuthProvider = {
  type: "agent",
  pluginId: "core",
  labelKey: "hosts.filterAuthAgent",
  requiresSecret: true,
  prepare: async (config, host, env) => {
    const result = await applyAgentAuth(
      config,
      host.terminalConfig as Record<string, unknown> | undefined,
    );
    if ("error" in result) {
      return { status: "error", code: "failed", message: result.error };
    }
    env.log("info", `SSH agent configured (socket: ${result.socketPath})`);
    return { status: "ready" };
  },
};

export const noneProvider: SshAuthProvider = {
  type: "none",
  pluginId: "core",
  labelKey: "hosts.filterAuthNone",
  // Keyboard-interactive only: a background poll would fire a live prompt
  // (a RADIUS or Duo push) with nobody there to answer it.
  supportsBackground: false,
  prepare: async (_config, _host, env) => {
    env.log("info", "Using keyboard-interactive authentication");
    return { status: "ready" };
  },
};

export const BUILTIN_SSH_AUTH_PROVIDERS: readonly SshAuthProvider[] = [
  passwordProvider,
  keyProvider,
  credentialProvider,
  agentProvider,
  noneProvider,
];

export function registerBuiltinSshAuthProviders(): () => void {
  const disposers = BUILTIN_SSH_AUTH_PROVIDERS.map((provider) =>
    registerSshAuthProvider(provider),
  );
  return () => disposers.forEach((dispose) => dispose());
}
