// Orchestrates the interactive Vault OIDC login that yields a signed,
// short-lived SSH certificate. Mirrors the OPKSSH session manager but is
// driven entirely over Vault's HTTP API (no external binary).
//
// Lifecycle:
//   - startVaultAuth(): generate ephemeral keypair, ask Vault for an OIDC
//     auth_url, stash a pending session keyed by the Vault-issued `state`,
//     and send the auth_url to the browser over the terminal WebSocket.
//   - The browser completes OIDC; the IdP redirects to VAULT_OIDC_CALLBACK_PATH.
//   - completeVaultAuth(): exchange the code for a Vault token, sign the
//     ephemeral key, cache the cert, and notify the browser to reconnect.

import { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { getDb } from "../database/db/index.js";
import { hosts, vaultProfiles } from "../database/db/schema.js";
import { sshLogger } from "../utils/logger.js";
import {
  type VaultProfileConfig,
  generateEphemeralKeyPair,
  startVaultOidc,
  completeVaultOidc,
  signWithVault,
  storeVaultCert,
} from "./vault-signer-auth.js";

export const VAULT_OIDC_CALLBACK_PATH = "/vault/oidc/callback";

const AUTH_TIMEOUT = 5 * 60 * 1000;

interface VaultAuthSession {
  state: string;
  userId: string;
  hostId: number;
  profile: VaultProfileConfig;
  clientNonce: string;
  ephemeralPrivateKey: string;
  ephemeralPublicKey: string;
  ws: WebSocket;
  timeout: NodeJS.Timeout;
}

// Keyed by the Vault-issued OIDC `state` so the unauthenticated browser callback
// can correlate back to the originating session.
const sessions = new Map<string, VaultAuthSession>();

function rowToProfileConfig(row: Record<string, unknown>): VaultProfileConfig {
  return {
    id: row.id as number,
    vaultAddr: row.vaultAddr as string,
    vaultNamespace: (row.vaultNamespace as string | null) ?? null,
    oidcMount: (row.oidcMount as string | null) ?? null,
    oidcRole: (row.oidcRole as string | null) ?? null,
    sshMount: (row.sshMount as string | null) ?? null,
    sshRole: row.sshRole as string,
    validPrincipals: (row.validPrincipals as string | null) ?? null,
    keyType: (row.keyType as string | null) ?? null,
  };
}

/** Load the Vault profile referenced by a host, or null if not configured. */
export async function loadVaultProfileForHost(
  hostId: number,
): Promise<VaultProfileConfig | null> {
  const db = getDb();
  const hostRows = await db
    .select()
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .limit(1);
  if (!hostRows.length || hostRows[0].vaultProfileId == null) return null;

  const profileRows = await db
    .select()
    .from(vaultProfiles)
    .where(eq(vaultProfiles.id, hostRows[0].vaultProfileId as number))
    .limit(1);
  if (!profileRows.length) return null;

  return rowToProfileConfig(profileRows[0] as Record<string, unknown>);
}

/**
 * Begin an interactive Vault OIDC login and send the auth URL to the browser.
 */
export async function startVaultAuth(
  userId: string,
  hostId: number,
  profile: VaultProfileConfig,
  ws: WebSocket,
  requestOrigin: string,
): Promise<void> {
  const ephemeral = generateEphemeralKeyPair(profile.keyType);
  const redirectUri = `${requestOrigin}${VAULT_OIDC_CALLBACK_PATH}`;

  const { authUrl, state, clientNonce } = await startVaultOidc(
    profile,
    redirectUri,
  );

  const existing = sessions.get(state);
  if (existing) clearTimeout(existing.timeout);

  const timeout = setTimeout(() => {
    sessions.delete(state);
  }, AUTH_TIMEOUT);

  sessions.set(state, {
    state,
    userId,
    hostId,
    profile,
    clientNonce,
    ephemeralPrivateKey: ephemeral.privateKey,
    ephemeralPublicKey: ephemeral.publicKey,
    ws,
    timeout,
  });

  sshLogger.info("Started Vault OIDC auth session", {
    operation: "vault_oidc_start",
    userId,
    hostId,
    profileId: profile.id,
  });

  ws.send(
    JSON.stringify({
      type: "vault_auth_url",
      hostId,
      url: authUrl,
    }),
  );
}

/**
 * Complete a Vault OIDC login from the browser callback: exchange the code for a
 * Vault token, sign the ephemeral key, cache the certificate, and notify the
 * browser to resume the SSH connection.
 */
export async function completeVaultAuth(
  state: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(state);
  if (!session) {
    return { ok: false, error: "No matching Vault authentication session" };
  }

  try {
    const token = await completeVaultOidc(session.profile, {
      state,
      code,
      clientNonce: session.clientNonce,
    });
    const signedCert = await signWithVault(
      session.profile,
      token,
      session.ephemeralPublicKey,
    );
    const expiresAt = await storeVaultCert(
      session.userId,
      session.profile.id,
      session.ephemeralPrivateKey,
      signedCert,
    );

    sshLogger.success("Completed Vault OIDC auth and cached certificate", {
      operation: "vault_oidc_complete",
      userId: session.userId,
      hostId: session.hostId,
      profileId: session.profile.id,
    });

    session.ws.send(
      JSON.stringify({
        type: "vault_completed",
        hostId: session.hostId,
        expiresAt,
      }),
    );
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sshLogger.error("Vault OIDC completion failed", e, {
      operation: "vault_oidc_complete_error",
      userId: session.userId,
      hostId: session.hostId,
    });
    try {
      session.ws.send(
        JSON.stringify({
          type: "vault_error",
          hostId: session.hostId,
          error: msg,
        }),
      );
    } catch {
      // ws may be closed
    }
    return { ok: false, error: msg };
  } finally {
    clearTimeout(session.timeout);
    sessions.delete(state);
  }
}

/** Cancel a pending Vault auth session (e.g. user dismissed the dialog). */
export function cancelVaultAuthByHost(userId: string, hostId: number): void {
  for (const [state, s] of sessions) {
    if (s.userId === userId && s.hostId === hostId) {
      clearTimeout(s.timeout);
      sessions.delete(state);
    }
  }
}
