/**
 * connectHost: the one way core and plugins open an SSH connection.
 *
 * Resolve the host (shared overrides, external secrets and owner decryption
 * all happen in resolveHostById), build the config through the host's auth
 * provider, open the transport, then connect with a keyboard-interactive
 * handler that either asks through a prompt channel or fills in the stored
 * password.
 */

import { Client } from "ssh2";
import { withConnection } from "../ssh-connection-pool.js";
import { resolveHostById } from "../host-resolver.js";
import { buildConnectConfig } from "./build-connect-config.js";
import {
  createAutoKeyboardInteractiveHandler,
  createPromptKeyboardInteractiveHandler,
  type KeyboardInteractiveListener,
} from "./keyboard-interactive.js";
import { openSshTransport, type OpenTransportOptions } from "./transport.js";
import type {
  MutableConnectConfig,
  SshAuthLog,
  SshAuthOutcome,
  SshConnectHost,
  SshConnectProfile,
  SshConnectPurpose,
  SshPromptChannel,
} from "./types.js";

export class SshConnectError extends Error {
  readonly code: string;
  constructor(readonly outcome: Exclude<SshAuthOutcome, { status: "ready" }>) {
    super(outcome.message);
    this.name = "SshConnectError";
    this.code =
      outcome.status === "error"
        ? outcome.code
        : outcome.status === "interaction-required"
          ? `${outcome.interaction}-required`
          : "retry";
  }
}

class SshHostNotFoundError extends Error {
  constructor(readonly hostId: number) {
    super("Host not found or access denied");
    this.name = "SshHostNotFoundError";
  }
}

export interface ConnectHostOptions {
  /** Acting user. Access and credentials are resolved for them. */
  userId: string;
  purpose: SshConnectPurpose;
  /** Keepalive and timeout defaults. Defaults to "background". */
  profile?: SshConnectProfile;
  /** Ask a person for keyboard-interactive answers. Without it, auto-fill. */
  prompt?: SshPromptChannel;
  /** Replaces the keyboard-interactive handler entirely. */
  keyboardInteractive?: KeyboardInteractiveListener;
  /** Config fields to force, e.g. a longer readyTimeout. */
  overrides?: Partial<MutableConnectConfig>;
  /** Overall timeout for reaching "ready". Defaults to 30s. */
  timeoutMs?: number;
  /** Use this client instead of a new one. */
  client?: Client;
  transport?: OpenTransportOptions;
  /**
   * An already-open stream to the host (a forwardOut channel through another
   * host). Skips openSshTransport entirely.
   */
  sock?: MutableConnectConfig["sock"];
  log?: SshAuthLog;
}

export interface SshConnection {
  client: Client;
  jumpClient: Client | null;
  host: SshConnectHost;
  config: MutableConnectConfig;
  /** Ends the connection and its jump chain. Safe to call twice. */
  dispose: () => void;
}

export async function resolveConnectHost(
  target: number | SshConnectHost,
  userId: string,
): Promise<SshConnectHost> {
  if (typeof target !== "number") return target;
  const host = await resolveHostById(target, userId);
  if (!host) throw new SshHostNotFoundError(target);
  return host as unknown as SshConnectHost;
}

export async function connectHost(
  target: number | SshConnectHost,
  options: ConnectHostOptions,
): Promise<SshConnection> {
  const host = await resolveConnectHost(target, options.userId);
  const client = options.client ?? new Client();

  const { config, provider, outcome, env } = await buildConnectConfig(host, {
    userId: options.userId,
    purpose: options.purpose,
    profile: options.profile,
    client,
    hostKeySocket: options.prompt?.hostKeySocket ?? null,
    interactive: !!options.prompt,
    log: options.log,
    overrides: options.overrides,
  });
  if (outcome.status !== "ready") {
    throw new SshConnectError(outcome);
  }

  let jumpClient: Client | null = null;
  if (options.sock) {
    config.sock = options.sock;
  } else {
    ({ jumpClient } = await openSshTransport(host, config, {
      log: options.log,
      ...options.transport,
    }));
  }

  const keyboardInteractive =
    options.keyboardInteractive ??
    (options.prompt
      ? createPromptKeyboardInteractiveHandler(host, options.prompt)
      : createAutoKeyboardInteractiveHandler(host));

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      client.end();
    } catch {
      // already closed
    }
    jumpClient?.end();
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      dispose();
      reject(new Error("SSH connection timeout"));
    }, options.timeoutMs ?? 30000);

    client.on("ready", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    });

    client.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      jumpClient?.end();
      const authFailed = /All configured authentication methods failed/i.test(
        error.message,
      );
      if (authFailed && provider?.onAuthFailed) {
        try {
          provider.onAuthFailed(host, env, {
            error,
            retries: 0,
            canRetry: false,
            methodNotAvailable: false,
          });
        } catch {
          // cleanup hooks never mask the connect error
        }
      }
      reject(error);
    });

    client.on("close", () => {
      jumpClient?.end();
    });

    client.on("keyboard-interactive", keyboardInteractive);
    client.connect(config);
  });

  return { client, jumpClient, host, config, dispose };
}

/** Pool key for a host and purpose, matching the keys the transports used. */
export function getConnectionPoolKey(
  prefix: string,
  host: SshConnectHost,
): string {
  const socks5Key = host.useSocks5
    ? `:socks5:${host.socks5Host}:${host.socks5Port}`
    : "";
  return `${prefix}:${host.userId}:${host.ip}:${host.port}:${host.username}${socks5Key}`;
}

/**
 * Runs fn on a pooled connection. The pool calls the factory only when it
 * has no idle connection for the key.
 */
export async function withHostConnection<T>(
  poolKey: string,
  target: number | SshConnectHost,
  options: ConnectHostOptions,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const host = await resolveConnectHost(target, options.userId);
  return withConnection(
    poolKey,
    async () => (await connectHost(host, options)).client,
    fn,
  );
}
