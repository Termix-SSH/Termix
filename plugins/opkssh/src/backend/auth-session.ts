import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  PluginContext,
  PluginProcessHandle,
} from "@termix/plugin-sdk/backend";
import {
  CONFIG_FILE,
  checkConfig,
  DOCS_URL,
  OPKSSH_DOCS_URL,
  validateRedirectUris,
} from "./config.js";
import type { CertificateIdentity, TokenStore } from "./token-store.js";

/** How long OPKSSH may wait for the browser sign-in. */
export const AUTH_TIMEOUT_MS = 60 * 1000;

/** Where the identity provider sends the browser back, before 2.9. */
export const LEGACY_CALLBACK_PATH = "/host/opkssh-callback";
/** The plugin's own routes, relative to the install's base URL. */
export const PLUGIN_PATH = "/plugin-api/opkssh";
export const CALLBACK_PATH = `${PLUGIN_PATH}/callback`;

/** The terminal socket, as far as a sign-in needs it. */
export interface SignInSocket {
  send: (data: string) => void;
  on: (event: "close", listener: () => void) => void;
}

export interface AuthSession {
  requestId: string;
  userId: string;
  hostId: number;
  /** OPKSSH's chooser listener on this server. */
  localPort: number;
  /** OPKSSH's login-callback listener on this server. */
  callbackPort: number;
  remoteRedirectUri: string;
  providers: Array<{ alias: string; issuer: string }>;
  status: "starting" | "waiting_for_auth" | "authenticating" | "completed";
  socket: SignInSocket;
  output: string;
  privateKey: string;
  sshCert: string;
  identity: CertificateIdentity;
  process: PluginProcessHandle | null;
  timeout: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

export interface StartRequest {
  userId: string;
  hostId: number;
  socket: SignInSocket;
  requestOrigin: string;
}

export type AuthSessions = ReturnType<typeof createAuthSessions>;

function send(socket: SignInSocket, message: Record<string, unknown>): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // socket already gone
  }
}

const CHOOSER_PATTERN =
  /(?:Opening browser to|Open your browser to:)\s*http:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/chooser/;
const CALLBACK_PORT_PATTERN =
  /listening on http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//;
const PRIVATE_KEY_PATTERN =
  /(-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----)/;
const CERT_PATTERN =
  /((?:ecdsa-sha2-nistp256|ssh-rsa|ssh-ed25519)-cert-v01@openssh\.com\s+[A-Za-z0-9+/=]+)/;
const IDENTITY_PATTERN =
  /Email, sub, issuer, audience:\s*\n?\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/;
const GENERIC_REDIRECT_ERRORS = [
  "redirect_uri",
  "redirect uri",
  "invalid redirect",
  "no matching redirect",
  "allowed redirect",
  "mismatching redirection",
];

/**
 * OPKSSH sign-ins in flight: one `opkssh login` process per session, whose
 * chooser and callback listeners the routes proxy. Created per activation.
 */
export function createAuthSessions(
  ctx: PluginContext,
  deps: {
    tokens: TokenStore;
    binaryPath: () => Promise<string>;
  },
) {
  const sessions = new Map<string, AuthSession>();
  const oauthStates = new Map<string, string>();

  async function configPath(): Promise<string> {
    return path.join(await ctx.files.dataDir(), CONFIG_FILE);
  }

  async function callbackPath(): Promise<string> {
    const legacy = await ctx.settings.get<boolean>("legacyCallback");
    return legacy ? LEGACY_CALLBACK_PATH : CALLBACK_PATH;
  }

  async function end(requestId: string): Promise<void> {
    const session = sessions.get(requestId);
    if (!session || session.closed) return;
    session.closed = true;
    if (session.timeout) clearTimeout(session.timeout);
    for (const [state, id] of oauthStates) {
      if (id === requestId) oauthStates.delete(state);
    }
    const child = session.process;
    if (child) {
      child.kill("SIGTERM");
      const forced = setTimeout(() => child.kill("SIGKILL"), 3000);
      await child.exited.catch(() => undefined);
      clearTimeout(forced);
    }
    sessions.delete(requestId);
  }

  async function complete(session: AuthSession): Promise<void> {
    if (!session.privateKey.includes("BEGIN OPENSSH PRIVATE KEY")) {
      send(session.socket, {
        type: "opkssh_error",
        requestId: session.requestId,
        error: "Failed to extract valid private key from OPKSSH output",
      });
      return;
    }
    if (!/-cert-v01@openssh\.com/.test(session.sshCert)) {
      send(session.socket, {
        type: "opkssh_error",
        requestId: session.requestId,
        error: "Failed to extract valid SSH certificate from OPKSSH output",
      });
      return;
    }
    session.status = "completed";
    try {
      const expiresAt = await deps.tokens.save(
        session.userId,
        session.hostId,
        { sshCert: session.sshCert, privateKey: session.privateKey },
        session.identity,
      );
      send(session.socket, {
        type: "opkssh_completed",
        requestId: session.requestId,
        expiresAt,
      });
    } catch (error) {
      ctx.log.error(
        `Failed to store OPKSSH certificate: ${error instanceof Error ? error.message : String(error)}`,
      );
      send(session.socket, {
        type: "opkssh_error",
        requestId: session.requestId,
        error: "Failed to store authentication token",
      });
    }
    await end(session.requestId);
  }

  function handleOutput(session: AuthSession, chunk: string): void {
    if (session.closed) return;
    session.output += chunk;

    const chooser = session.output.match(CHOOSER_PATTERN);
    if (chooser && session.status === "starting") {
      session.localPort = parseInt(chooser[1], 10);
      session.status = "waiting_for_auth";
      const origin = session.remoteRedirectUri.slice(
        0,
        session.remoteRedirectUri.length -
          (session.remoteRedirectUri.endsWith(LEGACY_CALLBACK_PATH)
            ? LEGACY_CALLBACK_PATH.length
            : CALLBACK_PATH.length),
      );
      send(session.socket, {
        type: "opkssh_status",
        requestId: session.requestId,
        stage: "chooser",
        url: `${origin}${PLUGIN_PATH}/chooser/${session.requestId}`,
        providers: session.providers,
        message: "Please authenticate in your browser",
      });
    }

    const callbackPort = session.output.match(CALLBACK_PORT_PATTERN);
    if (callbackPort && !session.callbackPort) {
      session.callbackPort = parseInt(callbackPort[1], 10);
    }

    if (chunk.includes("BEGIN OPENSSH PRIVATE KEY")) {
      session.status = "authenticating";
      send(session.socket, {
        type: "opkssh_status",
        requestId: session.requestId,
        stage: "authenticating",
        message: "Processing authentication...",
      });
    }

    const key = session.output.match(PRIVATE_KEY_PATTERN);
    if (key) session.privateKey = key[1].trim();
    const cert = session.output.match(CERT_PATTERN);
    if (cert) session.sshCert = cert[1].trim();
    const identity = session.output.match(IDENTITY_PATTERN);
    if (identity) {
      session.identity = {
        email: identity[1],
        sub: identity[2],
        issuer: identity[3],
        audience: identity[4],
      };
    }

    if (
      session.privateKey &&
      session.sshCert &&
      session.status !== "completed"
    ) {
      void complete(session);
    }
  }

  function handleStderr(session: AuthSession, stderr: string): void {
    if (
      stderr.includes("Opening browser to") ||
      stderr.includes("Open your browser to:") ||
      stderr.includes("listening on")
    ) {
      handleOutput(session, stderr);
    }

    const lower = stderr.toLowerCase();
    const configError = (error: string, instructions: string) => {
      send(session.socket, {
        type: "opkssh_config_error",
        requestId: session.requestId,
        error,
        instructions,
      });
      void end(session.requestId);
    };

    if (lower.includes("redirecturi must be localhost")) {
      ctx.log.warn("OPKSSH rejected a non-localhost entry in redirect_uris");
      configError(
        `OPKSSH rejected the local callback URI: every entry in 'redirect_uris' must be localhost.\n\n` +
          `OPKSSH output:\n${stderr.trim()}\n\n` +
          `The 'redirect_uris' config field is OPKSSH's LOCAL listener, not the public Termix callback. ` +
          `Remove any non-localhost entries from redirect_uris (or delete the whole block to use OPKSSH's ` +
          `defaults of :3000, :10001, :11110). Register the public Termix callback URL with your OAuth ` +
          `provider instead, Termix passes it to OPKSSH automatically via --remote-redirect-uri.`,
        `See documentation: ${DOCS_URL}`,
      );
      return;
    }

    if (GENERIC_REDIRECT_ERRORS.some((needle) => lower.includes(needle))) {
      ctx.log.warn("OPKSSH reported a redirect_uri error");
      configError(
        `OPKSSH or the OAuth provider rejected the redirect URI.\n\n` +
          `Computed Termix callback URI (sent to provider): ${session.remoteRedirectUri}\n\n` +
          `OPKSSH output:\n${stderr.trim()}\n\n` +
          `Register '${session.remoteRedirectUri}' as an authorized redirect URI with your OAuth provider. ` +
          `Also confirm any 'redirect_uris' in your OPKSSH config contain ONLY localhost URLs.`,
        `See documentation: ${DOCS_URL}`,
      );
      return;
    }

    if (
      stderr.includes("provider not found") ||
      stderr.includes("config error") ||
      stderr.includes("invalid config") ||
      stderr.includes("config not found")
    ) {
      configError(
        "OPKSSH configuration error. Please verify your config file contains valid OIDC provider settings.",
        `See documentation: ${OPKSSH_DOCS_URL}`,
      );
      return;
    }

    if (
      !stderr.includes('exec: "xdg-open"') &&
      (stderr.includes("bind: address already in use") ||
        stderr.includes("error logging in") ||
        stderr.includes("failed to start"))
    ) {
      void end(session.requestId);
    }
  }

  return {
    get: (requestId: string) => sessions.get(requestId),

    registerOAuthState(state: string, requestId: string): void {
      oauthStates.set(state, requestId);
    },

    /** Finds the session an identity provider callback belongs to. */
    takeByOAuthState(state: string): AuthSession | undefined {
      const requestId = oauthStates.get(state);
      if (!requestId) return undefined;
      oauthStates.delete(state);
      return sessions.get(requestId);
    },

    callbackPath,

    async start(request: StartRequest): Promise<string> {
      const { socket } = request;
      let config;
      try {
        config = await checkConfig(await configPath());
      } catch (error) {
        send(socket, {
          type: "opkssh_error",
          error: `OPKSSH directory initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        return "";
      }
      if (!config.ok) {
        send(socket, {
          type: "opkssh_config_error",
          requestId: "",
          error: config.error,
          instructions: config.error,
        });
        return "";
      }

      const remoteRedirectUri = `${request.requestOrigin}${await callbackPath()}`;
      const redirects = validateRedirectUris(
        config.providers,
        remoteRedirectUri,
      );
      if (redirects.ok === false) {
        send(socket, {
          type: "opkssh_config_error",
          requestId: "",
          error: redirects.message,
          instructions: redirects.message,
        });
        return "";
      }

      const requestId = randomUUID();
      const session: AuthSession = {
        requestId,
        userId: request.userId,
        hostId: request.hostId,
        localPort: 0,
        callbackPort: 0,
        remoteRedirectUri,
        providers: config.providers.map(({ alias, issuer }) => ({
          alias,
          issuer,
        })),
        status: "starting",
        socket,
        output: "",
        privateKey: "",
        sshCert: "",
        identity: {},
        process: null,
        timeout: null,
        closed: false,
      };
      sessions.set(requestId, session);

      try {
        const binary = await deps.binaryPath();
        const child = await ctx.process.run(binary, [
          "login",
          "--print-key",
          "--disable-browser-open",
          `--config-path=${config.configPath}`,
          `--remote-redirect-uri=${remoteRedirectUri}`,
        ]);
        session.process = child;
        session.timeout = setTimeout(() => {
          send(socket, { type: "opkssh_timeout", requestId });
          void end(requestId);
        }, AUTH_TIMEOUT_MS);
        socket.on("close", () => void end(requestId));

        child.onStdout((chunk) => handleOutput(session, chunk));
        child.onStderr((chunk) => handleStderr(session, chunk));
        child.exited.then(
          ({ code }) => {
            if (
              code !== 0 &&
              session.status !== "completed" &&
              !session.closed
            ) {
              send(socket, {
                type: "opkssh_error",
                requestId,
                error: `OPKSSH process exited with code ${code}`,
              });
            }
            void end(requestId);
          },
          (error: unknown) => {
            send(socket, {
              type: "opkssh_error",
              requestId,
              error: `OPKSSH process error: ${error instanceof Error ? error.message : String(error)}`,
            });
            void end(requestId);
          },
        );
        return requestId;
      } catch (error) {
        sessions.delete(requestId);
        ctx.log.error(
          `Failed to start OPKSSH sign-in: ${error instanceof Error ? error.message : String(error)}`,
        );
        send(socket, {
          type: "opkssh_error",
          requestId,
          error: `Failed to start OPKSSH authentication: ${error instanceof Error ? error.message : String(error)}`,
        });
        return "";
      }
    },

    cancel: (requestId: string) => end(requestId),

    /** Ends every session, for deactivate. */
    async closeAll(): Promise<void> {
      await Promise.all([...sessions.keys()].map((id) => end(id)));
    },
  };
}
