import type { Client, ConnectConfig } from "ssh2";
import type { WebSocket } from "ws";

/**
 * What a connection is for. Picks keepalive and timeout defaults so every
 * transport keeps the numbers it had before the pipeline existed.
 */
export type SshConnectPurpose =
  | "terminal"
  | "file-manager"
  | "file-transfer"
  | "tmux"
  | "metrics"
  | "fleet"
  | "tunnel"
  | "docker"
  | "docker-console"
  | "proxmox"
  | "snippet"
  | "credential-deploy"
  | "jump-host"
  | "remote-desktop"
  | "plugin";

/** The resolved host fields the pipeline reads. */
export interface SshConnectHost {
  id: number;
  ip: string;
  port: number;
  username: string;
  userId?: string | null;
  authType?: string | null;
  password?: string | null;
  key?: string | Buffer | null;
  keyPassword?: string | null;
  keyType?: string | null;
  certPublicKey?: string | null;
  useWarpgate?: boolean | null;
  forceKeyboardInteractive?: boolean | null;
  vaultProfile?: { id?: number | null } | null;
  terminalConfig?: Record<string, unknown> | null;
  jumpHosts?: Array<{ hostId: number }> | null;
  useSocks5?: boolean | null;
  socks5Host?: string | null;
  socks5Port?: number | null;
  socks5Username?: string | null;
  socks5Password?: string | null;
  socks5ProxyChain?: unknown;
  portKnockSequence?: Array<{
    port: number;
    protocol?: string;
    delay?: number;
  }> | null;
  [key: string]: unknown;
}

export type MutableConnectConfig = ConnectConfig & Record<string, unknown>;

export type SshAuthLog = (
  level: "info" | "warning" | "error",
  message: string,
) => void;

export interface SshAuthEnv {
  /** The client about to connect; certificate auth patches it. */
  client: Client;
  /** The acting user. Certificates and tokens are cached per user. */
  userId: string;
  /** Server-side host id, used for per-host caches. */
  hostId: number;
  purpose: SshConnectPurpose;
  /** True when a person can answer prompts or finish a browser sign-in. */
  interactive: boolean;
  log: SshAuthLog;
}

/**
 * What preparing auth produced.
 *
 * `interaction-required` means a browser step has to happen first; the
 * transport turns `interaction` into its own message, for example
 * `opkssh_auth_required` over the terminal socket.
 */
export type SshAuthOutcome =
  | { status: "ready" }
  | {
      status: "interaction-required";
      interaction: string;
      message: string;
      /** Extra boolean the HTTP transports set in their 401 body. */
      flag?: string;
    }
  | {
      status: "error";
      code:
        | "missing-secret"
        | "invalid-key"
        | "passphrase-required"
        | "provider-missing"
        | "failed";
      message: string;
    }
  | {
      /** Try once more with these config changes. Used by Tailscale. */
      status: "retry";
      patch: Partial<MutableConnectConfig>;
      message: string;
    };

export interface SshAuthFailureContext {
  error: Error;
  /** How many retries this connection already made. */
  retries: number;
  /** A tunnelled socket cannot be reused for a retry. */
  canRetry: boolean;
  /** The server refused keyboard-interactive or none. */
  methodNotAvailable: boolean;
}

export interface SshInteractionRequest {
  userId: string;
  hostId: number;
  /** Host row as stored, not resolved. */
  host: { name?: string | null; ip: string; username: string };
  socket: WebSocket;
  requestOrigin: string;
  /** Anything the client sent with the start message. */
  payload: Record<string, unknown>;
}

export interface SshAuthField {
  key: string;
  type:
    | "boolean"
    | "string"
    | "number"
    | "select"
    | "secret"
    | "textarea"
    | "custom";
  labelKey?: string;
  descriptionKey?: string;
  placeholderKey?: string;
  default?: unknown;
  options?: Array<{ value: string; labelKey: string }>;
  component?: string;
}

export interface SshAuthProvider {
  /** Stored in ssh_data.auth_type. */
  type: string;
  /** "core" for built-ins and the legacy providers A8 keeps in core. */
  pluginId: string;
  labelKey: string;
  descriptionKey?: string;
  /** Editor fields, rendered by core unless the frontend registered an editor. */
  fields?: SshAuthField[];
  /** Also offered as a stored credential type. */
  credentialType?: boolean;
  /** Needs a browser sign-in or a person at the keyboard. */
  needsUserInteraction?: boolean;
  /** Carries a secret, so a shared host needs one resolved for the recipient. */
  requiresSecret?: boolean;
  /**
   * Can connect with nobody watching, for polling and batch work. Defaults to
   * true; false for types that need a person or a fresh browser sign-in.
   */
  supportsBackground?: boolean;
  /** Overrides applied to the base config before prepare runs. */
  connectOptions?: (
    host: SshConnectHost,
    purpose: SshConnectPurpose,
  ) => Partial<MutableConnectConfig>;
  /** The interaction name this provider's outcomes use, e.g. "opkssh". */
  interaction?: string;
  /**
   * Starts the browser step behind an `interaction-required` outcome, for
   * transports that can show one (the terminal today).
   */
  startInteraction?: (request: SshInteractionRequest) => Promise<void>;
  prepare: (
    config: MutableConnectConfig,
    host: SshConnectHost,
    env: SshAuthEnv,
  ) => Promise<SshAuthOutcome>;
  /**
   * Called when the server rejected auth. Synchronous on purpose: transports
   * decide on a retry before the socket's close event arrives. Cache cleanup
   * inside runs in the background.
   */
  onAuthFailed?: (
    host: SshConnectHost,
    env: SshAuthEnv,
    context: SshAuthFailureContext,
  ) => SshAuthOutcome | undefined;
}

export interface KeyboardInteractivePrompt {
  prompt: string;
  echo?: boolean;
}

/** What to do with one keyboard-interactive round. */
export type KeyboardInteractiveDecision =
  | { kind: "auto"; responses: string[] }
  | {
      kind: "warpgate";
      url: string | null;
      securityKey: string;
      instructions: string;
    }
  | { kind: "totp"; promptIndex: number }
  | { kind: "input"; promptIndex: number; isPush: boolean };

/**
 * Interceptors run before the built-in classifier. A provider that owns a
 * prompt style (Warpgate today) returns a decision; everyone else returns null.
 */
export interface KeyboardInteractiveInterceptor {
  id: string;
  pluginId: string;
  detect: (
    round: {
      name: string;
      instructions: string;
      prompts: KeyboardInteractivePrompt[];
    },
    host: SshConnectHost,
  ) => KeyboardInteractiveDecision | null;
  /** Answer password prompts silently instead of asking the user. */
  autoAnswerPasswords?: (host: SshConnectHost) => boolean;
}

/**
 * How a transport asks a person something mid-connect.
 *
 * `ask` resolves with the typed answer, or null when the user gave up or the
 * transport has nobody to ask. The terminal answers over its WebSocket, the
 * file manager parks the connection and answers over HTTP.
 */
export interface SshPromptChannel {
  ask: (request: SshPromptRequest) => Promise<string | null>;
  /** Terminal socket used for the host key prompt, when there is one. */
  hostKeySocket?: WebSocket | null;
}

export type SshPromptRequest =
  | { kind: "totp"; prompt: string; retry: boolean }
  | { kind: "input"; prompt: string; echo: boolean; isPush: boolean }
  | {
      kind: "warpgate";
      url: string | null;
      securityKey: string;
      instructions: string;
    };
