import { randomBytes } from "node:crypto";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { CertStore } from "./cert-store.js";
import type { CallbackQuery, CallbackResult, Runtime } from "./runtime.js";
import {
  buildAuthorizationUrl,
  createPkce,
  decodeJwtClaims,
  discoverOidcEndpoints,
  exchangeCodeForIdToken,
  fetchRootCertificate,
  findOidcProvisioner,
  generateSshKeyPair,
  parseSshCertificate,
  signSshCertificate,
  type StepCaTarget,
} from "./client.js";

/** The redirect URI 2.8 registered with identity providers. */
export const LEGACY_CALLBACK_PATH = "/host/step-ca-callback";
export const CALLBACK_PATH = "/plugin-api/step-ca/callback";

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const REMOTE_CALLBACK_WAIT_MS = 30_000;
const REMOTE_POLL_MS = 250;

/** The terminal socket, as far as a sign-in needs it. */
export interface SignInSocket {
  send: (data: string) => void;
  on: (event: "close", listener: () => void) => void;
}

export interface StartRequest {
  userId: string;
  hostId: number;
  username: string;
  socket: SignInSocket;
  requestOrigin: string;
}

interface Session {
  state: string;
  userId: string;
  hostId: number;
  username: string;
  socket: SignInSocket;
  target: StepCaTarget;
  rootPem: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  redirectUri: string;
  codeVerifier: string;
  nonce: string;
  keyPair: { publicKeyLine: string; privateKeyPem: string };
  timeout: ReturnType<typeof setTimeout>;
  commandPoll: ReturnType<typeof setInterval> | null;
  processing: boolean;
  completed: boolean;
}

export interface StepCaSettings {
  caUrl: string;
  fingerprint: string;
  provisioner: string;
  privateEndpoints: string[];
}

/** Comma or newline separated hosts, lower-cased. */
export function parseHostList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function send(socket: SignInSocket, message: Record<string, unknown>): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // socket already gone
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type AuthSessions = ReturnType<typeof createAuthSessions>;

/**
 * Step CA sign-ins in flight: the OIDC authorization-code flow against the
 * CA's provisioner, then the CA signs a fresh key. Created per activation.
 */
export function createAuthSessions(
  ctx: PluginContext,
  deps: { certs: CertStore; runtime: Runtime },
) {
  const sessions = new Map<string, Session>();

  async function readSettings(): Promise<StepCaSettings | null> {
    const [caUrl, fingerprint, provisioner, privateEndpoints] =
      await Promise.all([
        ctx.settings.get<string>("caUrl"),
        ctx.settings.get<string>("fingerprint"),
        ctx.settings.get<string>("provisioner"),
        ctx.settings.get<string>("privateEndpoints"),
      ]);
    if (!caUrl?.trim() || !fingerprint?.trim() || !provisioner?.trim()) {
      return null;
    }
    return {
      caUrl: caUrl.trim(),
      fingerprint: fingerprint.trim(),
      provisioner: provisioner.trim(),
      privateEndpoints: parseHostList(privateEndpoints),
    };
  }

  async function callbackPath(): Promise<string> {
    const legacy = await ctx.settings.get<boolean>("legacyCallback");
    return legacy ? LEGACY_CALLBACK_PATH : CALLBACK_PATH;
  }

  function end(session: Session, removeRuntime = true): void {
    clearTimeout(session.timeout);
    if (session.commandPoll) clearInterval(session.commandPoll);
    sessions.delete(session.state);
    if (removeRuntime) void deps.runtime.remove(session.state);
  }

  async function finish(
    session: Session,
    query: CallbackQuery,
    removeRuntime = true,
  ): Promise<CallbackResult> {
    if (query.error || !query.code) {
      const message =
        query.error_description || query.error || "Sign-in failed";
      send(session.socket, {
        type: "stepca_error",
        requestId: session.state,
        error: `Step CA: ${message}`,
      });
      end(session, removeRuntime);
      return { ok: false, message };
    }

    try {
      send(session.socket, {
        type: "stepca_status",
        requestId: session.state,
        stage: "authenticating",
      });
      const idToken = await exchangeCodeForIdToken({
        fetch: ctx.fetch,
        tokenEndpoint: session.tokenEndpoint,
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        code: query.code,
        redirectUri: session.redirectUri,
        codeVerifier: session.codeVerifier,
        allowedPrivateHosts: session.target.allowedPrivateHosts,
      });
      const claims = decodeJwtClaims(idToken);
      if (claims.nonce !== session.nonce) {
        throw new Error("The identity token does not match this sign-in");
      }
      const email = typeof claims.email === "string" ? claims.email : undefined;

      const certificate = await signSshCertificate(
        session.target,
        session.rootPem,
        {
          publicKeyLine: session.keyPair.publicKeyLine,
          ott: idToken,
          principals: [session.username],
          keyId: email ?? session.username,
        },
      );

      const info = parseSshCertificate(certificate);
      if (info.publicKeyLine !== session.keyPair.publicKeyLine) {
        throw new Error("The CA returned a certificate for a different key");
      }
      if (!info.principals.includes(session.username)) {
        throw new Error(
          "The CA certificate does not include the host username",
        );
      }
      const now = Date.now();
      if (
        info.validBefore.getTime() <= now ||
        info.validAfter.getTime() > now + 60_000
      ) {
        throw new Error(
          "The CA returned a certificate outside its validity window",
        );
      }

      await deps.certs.save(
        session.userId,
        session.hostId,
        { sshCert: certificate, privateKey: session.keyPair.privateKeyPem },
        info.validBefore,
        email,
      );

      session.completed = true;
      send(session.socket, {
        type: "stepca_completed",
        requestId: session.state,
        expiresAt: info.validBefore.toISOString(),
      });
      end(session, removeRuntime);
      return { ok: true, message: "Signed in. You can close this window." };
    } catch (error) {
      const message = errorMessage(error);
      ctx.log.error(`Step CA certificate issuance failed: ${message}`);
      send(session.socket, {
        type: "stepca_error",
        requestId: session.state,
        error: `Step CA: ${message}`,
      });
      end(session, removeRuntime);
      return { ok: false, message };
    }
  }

  return {
    async start(request: StartRequest): Promise<void> {
      const settings = await readSettings();
      if (!settings) {
        send(request.socket, {
          type: "stepca_config_error",
          requestId: "",
          error:
            "Step CA is not configured. An administrator must set the CA URL, root fingerprint and OIDC provisioner in the Step CA plugin settings.",
        });
        return;
      }

      const state = randomBytes(24).toString("base64url");
      try {
        const target: StepCaTarget = {
          fetch: ctx.fetch,
          caUrl: settings.caUrl,
          fingerprint: settings.fingerprint,
          allowedPrivateHosts: settings.privateEndpoints,
        };
        const rootPem = await fetchRootCertificate(target);
        const provisioner = await findOidcProvisioner(
          target,
          rootPem,
          settings.provisioner,
        );
        const endpoints = await discoverOidcEndpoints(
          ctx.fetch,
          provisioner.configurationEndpoint,
          target.allowedPrivateHosts,
        );
        const pkce = createPkce();
        const nonce = randomBytes(16).toString("base64url");
        const redirectUri = `${request.requestOrigin}${await callbackPath()}`;

        const session: Session = {
          state,
          userId: request.userId,
          hostId: request.hostId,
          username: request.username,
          socket: request.socket,
          target,
          rootPem,
          clientId: provisioner.clientID,
          clientSecret: provisioner.clientSecret,
          tokenEndpoint: endpoints.tokenEndpoint,
          redirectUri,
          codeVerifier: pkce.verifier,
          nonce,
          keyPair: generateSshKeyPair(),
          processing: false,
          completed: false,
          commandPoll: null,
          timeout: setTimeout(() => {
            const current = sessions.get(state);
            if (!current || current.completed || current.processing) return;
            send(request.socket, { type: "stepca_timeout", requestId: state });
            end(current);
          }, AUTH_TIMEOUT_MS),
        };
        sessions.set(state, session);
        await deps.runtime.register(state);
        // Another instance may receive the callback and queue it for us.
        session.commandPoll = setInterval(() => {
          if (session.processing || session.completed) return;
          void deps.runtime.takeCommand(state).then(async (query) => {
            if (!query || session.processing || session.completed) return;
            session.processing = true;
            const result = await finish(session, query, false);
            await deps.runtime.complete(state, result);
          });
        }, REMOTE_POLL_MS);
        session.commandPoll.unref?.();
        request.socket.on("close", () => {
          const current = sessions.get(state);
          if (current && !current.completed) end(current);
        });

        send(request.socket, {
          type: "stepca_status",
          requestId: state,
          stage: "chooser",
          url: buildAuthorizationUrl({
            authorizationEndpoint: endpoints.authorizationEndpoint,
            clientId: provisioner.clientID,
            redirectUri,
            state,
            nonce,
            codeChallenge: pkce.challenge,
          }),
        });
      } catch (error) {
        ctx.log.error(
          `Failed to start Step CA authentication: ${errorMessage(error)}`,
        );
        send(request.socket, {
          type: "stepca_error",
          requestId: state,
          error: `Step CA: ${errorMessage(error)}`,
        });
      }
    },

    cancel(requestId: string): boolean {
      const session = sessions.get(requestId);
      if (!session) return false;
      end(session);
      return true;
    },

    /**
     * The identity provider's redirect: exchanges the code, has the CA sign
     * the key and stores the certificate. A sign-in another instance started
     * is handed to it through the runtime.
     */
    async complete(query: CallbackQuery): Promise<CallbackResult> {
      const session = query.state ? sessions.get(query.state) : undefined;
      if (!session) {
        if (!query.state || !(await deps.runtime.submit(query.state, query))) {
          return {
            ok: false,
            message: "This sign-in request is no longer active.",
          };
        }
        const deadline = Date.now() + REMOTE_CALLBACK_WAIT_MS;
        while (Date.now() < deadline) {
          const result = await deps.runtime.takeResult(query.state);
          if (result) return result;
          await new Promise((resolve) => setTimeout(resolve, REMOTE_POLL_MS));
        }
        return {
          ok: false,
          message: "The Termix instance handling this sign-in did not respond.",
        };
      }
      if (session.processing || session.completed) {
        return { ok: false, message: "This sign-in request was already used." };
      }
      session.processing = true;
      return finish(session, query);
    },

    closeAll(): void {
      for (const session of [...sessions.values()]) end(session);
    },
  };
}
