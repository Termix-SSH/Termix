import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { TokenStore } from "./token-store.js";
import {
  completeVaultOidc,
  generateEphemeralKeyPair,
  signWithVault,
  startVaultOidc,
  type VaultProfileConfig,
} from "./vault-client.js";

/** The redirect URI 2.8 had Vault roles allow. */
export const LEGACY_CALLBACK_PATH = "/vault/oidc/callback";
export const CALLBACK_PATH = "/plugin-api/vault/oidc/callback";

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** The terminal socket, as far as a sign-in needs it. */
export interface SignInSocket {
  send: (data: string) => void;
  on?: (event: "close", listener: () => void) => void;
}

export interface StartRequest {
  userId: string;
  hostId: number;
  profile: VaultProfileConfig;
  socket: SignInSocket;
  requestOrigin: string;
}

export interface CallbackResult {
  ok: boolean;
  message: string;
}

interface Session {
  state: string;
  userId: string;
  hostId: number;
  profile: VaultProfileConfig;
  clientNonce: string;
  privateKey: string;
  publicKey: string;
  socket: SignInSocket;
  timeout: ReturnType<typeof setTimeout>;
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
 * Vault OIDC sign-ins in flight, keyed by the state Vault put in its auth
 * URL so the unauthenticated browser callback finds its way back. Created
 * per activation; closeAll runs on deactivate.
 */
export function createAuthSessions(ctx: PluginContext, tokens: TokenStore) {
  const sessions = new Map<string, Session>();

  function end(session: Session): void {
    clearTimeout(session.timeout);
    sessions.delete(session.state);
  }

  async function callbackPath(): Promise<string> {
    const legacy = await ctx.settings.get<boolean>("legacyCallback");
    return legacy ? LEGACY_CALLBACK_PATH : CALLBACK_PATH;
  }

  return {
    /** Asks Vault for an auth URL and sends it to the terminal. */
    async start(request: StartRequest): Promise<void> {
      try {
        const keyPair = generateEphemeralKeyPair(request.profile.keyType);
        const redirectUri = `${request.requestOrigin}${await callbackPath()}`;
        const { authUrl, state, clientNonce } = await startVaultOidc(
          ctx.fetch,
          request.profile,
          redirectUri,
        );

        const existing = sessions.get(state);
        if (existing) end(existing);

        const session: Session = {
          state,
          userId: request.userId,
          hostId: request.hostId,
          profile: request.profile,
          clientNonce,
          privateKey: keyPair.privateKey,
          publicKey: keyPair.publicKey,
          socket: request.socket,
          timeout: setTimeout(() => {
            const current = sessions.get(state);
            if (current) end(current);
          }, AUTH_TIMEOUT_MS),
        };
        sessions.set(state, session);
        request.socket.on?.("close", () => {
          const current = sessions.get(state);
          if (current) end(current);
        });

        send(request.socket, {
          type: "vault_auth_url",
          hostId: request.hostId,
          requestId: state,
          url: authUrl,
        });
      } catch (error) {
        const message = errorMessage(error);
        ctx.log.error(`Failed to start Vault authentication: ${message}`);
        send(request.socket, {
          type: "vault_error",
          hostId: request.hostId,
          error: message,
        });
      }
    },

    /**
     * The identity provider's redirect, via Vault: exchanges the code for a
     * Vault token, has Vault sign the ephemeral key and caches the result.
     */
    async complete(state: string, code: string): Promise<CallbackResult> {
      const session = sessions.get(state);
      if (!session) {
        return {
          ok: false,
          message: "This sign-in request is no longer active.",
        };
      }
      end(session);

      try {
        const token = await completeVaultOidc(ctx.fetch, session.profile, {
          state,
          code,
          clientNonce: session.clientNonce,
        });
        const signed = await signWithVault(
          ctx.fetch,
          session.profile,
          token,
          session.publicKey,
        );
        const expiresAt = await tokens.save(
          session.userId,
          session.profile.id,
          session.privateKey,
          signed,
        );
        ctx.log.info(
          `Vault signed a certificate for host ${session.hostId} with profile ${session.profile.id}`,
        );
        send(session.socket, {
          type: "vault_completed",
          hostId: session.hostId,
          requestId: state,
          expiresAt,
        });
        return {
          ok: true,
          message: "You can close this window and return to Termix.",
        };
      } catch (error) {
        const message = errorMessage(error);
        ctx.log.error(`Vault sign-in failed: ${message}`);
        send(session.socket, {
          type: "vault_error",
          hostId: session.hostId,
          requestId: state,
          error: message,
        });
        return { ok: false, message };
      }
    },

    /** Cancels by request id, or every sign-in the user has for a host. */
    cancel(userId: string, hostId?: number, requestId?: string): void {
      for (const session of [...sessions.values()]) {
        if (session.userId !== userId) continue;
        if (
          requestId ? session.state === requestId : session.hostId === hostId
        ) {
          end(session);
        }
      }
    },

    closeAll(): void {
      for (const session of [...sessions.values()]) end(session);
    },
  };
}
