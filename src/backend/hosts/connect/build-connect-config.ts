import type { Client } from "ssh2";
import type { WebSocket } from "ws";
import { buildSSHAlgorithms } from "../../utils/ssh-algorithms.js";
import { SSHHostKeyVerifier } from "../host-key-verifier.js";
import { resolveSshKeepalive } from "../ssh-keepalive.js";
import {
  SshAuthProviderMissingError,
  requireSshAuthProvider,
} from "./auth-provider-registry.js";
import { ensureCoreSshAuthProviders } from "./core-providers.js";
import type {
  MutableConnectConfig,
  SshAuthEnv,
  SshAuthLog,
  SshAuthOutcome,
  SshAuthProvider,
  SshConnectHost,
  SshConnectPurpose,
} from "./types.js";

interface PurposeDefaults {
  keepaliveIntervalMs: number;
  keepaliveCountMax: number;
  /** Let terminalConfig.keepalive* override the defaults. */
  hostKeepalive: boolean;
  readyTimeout: number;
  /** Socket idle timeout, when the transport set one. */
  socketTimeout?: number;
  env: Record<string, string> | null;
}

const TERMINAL_ENV: Record<string, string> = {
  TERM: "xterm-256color",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  LC_CTYPE: "en_US.UTF-8",
  LC_MESSAGES: "en_US.UTF-8",
  LC_MONETARY: "en_US.UTF-8",
  LC_NUMERIC: "en_US.UTF-8",
  LC_TIME: "en_US.UTF-8",
  LC_COLLATE: "en_US.UTF-8",
  COLORTERM: "truecolor",
};

const BASIC_ENV: Record<string, string> = {
  TERM: "xterm-256color",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
};

// The values each transport used before it moved onto the pipeline.
const PURPOSE_DEFAULTS: Record<SshConnectPurpose, PurposeDefaults> = {
  terminal: {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 5,
    hostKeepalive: true,
    readyTimeout: 120000,
    socketTimeout: 120000,
    env: TERMINAL_ENV,
  },
  "file-manager": {
    keepaliveIntervalMs: 60000,
    keepaliveCountMax: 5,
    hostKeepalive: true,
    readyTimeout: 60000,
    env: TERMINAL_ENV,
  },
  "file-transfer": {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 120,
    hostKeepalive: false,
    readyTimeout: 60000,
    env: null,
  },
  tmux: {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 3,
    hostKeepalive: false,
    readyTimeout: 60000,
    env: null,
  },
  metrics: {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 3,
    hostKeepalive: false,
    readyTimeout: 30000,
    env: BASIC_ENV,
  },
  fleet: {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 3,
    hostKeepalive: false,
    readyTimeout: 30000,
    env: BASIC_ENV,
  },
  tunnel: {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 3,
    hostKeepalive: true,
    readyTimeout: 60000,
    env: null,
  },
  docker: {
    keepaliveIntervalMs: 60000,
    keepaliveCountMax: 5,
    hostKeepalive: true,
    readyTimeout: 60000,
    env: TERMINAL_ENV,
  },
  "docker-console": {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 120,
    hostKeepalive: false,
    readyTimeout: 60000,
    env: null,
  },
  proxmox: {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 3,
    hostKeepalive: false,
    readyTimeout: 20000,
    env: null,
  },
  snippet: {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 3,
    hostKeepalive: false,
    readyTimeout: 30000,
    env: null,
  },
  "credential-deploy": {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 3,
    hostKeepalive: false,
    readyTimeout: 30000,
    env: null,
  },
  "jump-host": {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 3,
    hostKeepalive: false,
    readyTimeout: 60000,
    env: null,
  },
  "remote-desktop": {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 3,
    hostKeepalive: false,
    readyTimeout: 60000,
    env: null,
  },
  plugin: {
    keepaliveIntervalMs: 30000,
    keepaliveCountMax: 3,
    hostKeepalive: false,
    readyTimeout: 30000,
    env: BASIC_ENV,
  },
};

export function getPurposeDefaults(
  purpose: SshConnectPurpose,
): PurposeDefaults {
  return PURPOSE_DEFAULTS[purpose];
}

export interface BuildConnectConfigOptions {
  /** Acting user: host key trust, certificates and tokens are per user. */
  userId: string;
  purpose: SshConnectPurpose;
  client: Client;
  /** Server-side host id when it differs from host.id (sync-id lookups). */
  serverHostId?: number;
  /** Terminal socket for the changed-host-key prompt. */
  hostKeySocket?: WebSocket | null;
  interactive?: boolean;
  log?: SshAuthLog;
  /** Applied after the purpose defaults and before auth is prepared. */
  overrides?: Partial<MutableConnectConfig>;
}

export interface BuiltConnectConfig {
  config: MutableConnectConfig;
  provider: SshAuthProvider | null;
  outcome: SshAuthOutcome;
  env: SshAuthEnv;
}

const noopLog: SshAuthLog = () => {};

export function stripIpv6Brackets(ip: string): string {
  return ip?.replace(/^\[|\]$/g, "") || ip;
}

/**
 * Builds the ssh2 config for one host: base settings for the purpose, the
 * host verifier, then the auth provider's prepare step. Never connects.
 */
export async function buildConnectConfig(
  host: SshConnectHost,
  options: BuildConnectConfigOptions,
): Promise<BuiltConnectConfig> {
  ensureCoreSshAuthProviders();

  const defaults = PURPOSE_DEFAULTS[options.purpose];
  const authType = host.authType || "none";
  const serverHostId = options.serverHostId ?? host.id;
  const isJumpHost = options.purpose === "jump-host";
  const terminalConfig = (host.terminalConfig ?? undefined) as
    Record<string, unknown> | undefined;

  const keepalive = defaults.hostKeepalive
    ? resolveSshKeepalive(
        terminalConfig?.keepaliveInterval as number | undefined,
        terminalConfig?.keepaliveCountMax as number | undefined,
        defaults.keepaliveIntervalMs,
        defaults.keepaliveCountMax,
      )
    : {
        keepaliveInterval: defaults.keepaliveIntervalMs,
        keepaliveCountMax: defaults.keepaliveCountMax,
      };

  const preloaded = serverHostId
    ? await SSHHostKeyVerifier.preloadHostData(serverHostId)
    : null;

  const config: MutableConnectConfig = {
    host: stripIpv6Brackets(host.ip),
    port: host.port || 22,
    username: host.username,
    // A jump hop with no auth never answered prompts before either.
    tryKeyboard: isJumpHost ? authType !== "none" : true,
    ...keepalive,
    readyTimeout: defaults.readyTimeout,
    tcpKeepAlive: true,
    tcpKeepAliveInitialDelay: 30000,
    hostVerifier: await SSHHostKeyVerifier.createHostVerifier(
      serverHostId,
      host.ip,
      host.port || 22,
      options.hostKeySocket ?? null,
      options.userId,
      isJumpHost,
      preloaded,
    ),
    algorithms: buildSSHAlgorithms(
      terminalConfig?.allowLegacyAlgorithms !== false,
    ),
  };
  if (defaults.env) config.env = { ...defaults.env };
  if (defaults.socketTimeout) config.timeout = defaults.socketTimeout;

  const env: SshAuthEnv = {
    client: options.client,
    userId: options.userId,
    hostId: serverHostId,
    purpose: options.purpose,
    interactive: options.interactive ?? false,
    log: options.log ?? noopLog,
  };

  let provider: SshAuthProvider;
  try {
    provider = requireSshAuthProvider(authType);
  } catch (error) {
    if (error instanceof SshAuthProviderMissingError) {
      return {
        config,
        provider: null,
        env,
        outcome: {
          status: "error",
          code: "provider-missing",
          message: error.message,
        },
      };
    }
    throw error;
  }

  if (provider.connectOptions) {
    Object.assign(config, provider.connectOptions(host, options.purpose));
  }
  if (options.overrides) {
    Object.assign(config, options.overrides);
  }

  const outcome = await provider.prepare(config, host, env);
  return { config, provider, outcome, env };
}
