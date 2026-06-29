// HashiCorp Vault SSH signer authentication.
//
// Flow (mirrors the OPKSSH subsystem, but Vault-driven over HTTP):
//   1. Generate an ephemeral SSH keypair (never persisted long-term).
//   2. The user authenticates to Vault via an interactive OIDC flow
//      (auth/<mount>/oidc/auth_url -> browser -> auth/<mount>/oidc/callback),
//      yielding a short-lived Vault token.
//   3. Vault's SSH secrets engine signs the ephemeral public key
//      (<sshMount>/sign/<role>) -> short-lived OpenSSH certificate.
//   4. The ephemeral private key + certificate are cached per-user (encrypted)
//      until the certificate expires, then used to connect via setupOPKSSHCertAuth.
//
// No Vault tokens, AppRole secrets, or long-lived private keys are ever stored.
// Vault connection SETTINGS live in shareable vault_profiles rows.
//
// The pure (DB-free) signing/OIDC/cert logic lives in vault-signer-core.ts and
// is re-exported here so callers have a single import surface.

import { and, eq } from "drizzle-orm";
import { getDb } from "../database/db/index.js";
import { vaultTokens } from "../database/db/schema.js";
import { UserCrypto } from "../utils/user-crypto.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import { parseCertValidBefore } from "./vault-signer-core.js";

export type {
  VaultProfileConfig,
  EphemeralKeyPair,
} from "./vault-signer-core.js";
export {
  generateEphemeralKeyPair,
  startVaultOidc,
  completeVaultOidc,
  signWithVault,
  parseCertValidBefore,
} from "./vault-signer-core.js";

// Re-sign once we're within this many seconds of expiry.
const EXPIRY_SKEW_SECONDS = 60;

function cacheRecordId(userId: string, profileId: number): string {
  return `vault-${userId}-${profileId}`;
}

/**
 * Store an ephemeral private key + signed certificate for a user/profile.
 * Returns the expiry as an ISO string.
 */
export async function storeVaultCert(
  userId: string,
  profileId: number,
  privateKey: string,
  signedCert: string,
): Promise<string> {
  const db = getDb();
  const userDataKey = UserCrypto.getInstance().getUserDataKey(userId);
  if (!userDataKey) {
    throw new Error("User data key not found");
  }

  const validBefore = parseCertValidBefore(signedCert);
  const expiresMs =
    validBefore > 0 ? validBefore * 1000 : Date.now() + 5 * 60 * 1000;
  const expiresAt = new Date(expiresMs).toISOString();

  const recordId = cacheRecordId(userId, profileId);
  const encryptedCert = FieldCrypto.encryptField(
    signedCert,
    userDataKey,
    recordId,
    "ssh_cert",
  );
  const encryptedKey = FieldCrypto.encryptField(
    privateKey,
    userDataKey,
    recordId,
    "private_key",
  );

  await db
    .insert(vaultTokens)
    .values({
      userId,
      profileId,
      sshCert: encryptedCert,
      privateKey: encryptedKey,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [vaultTokens.userId, vaultTokens.profileId],
      set: {
        sshCert: encryptedCert,
        privateKey: encryptedKey,
        expiresAt,
        createdAt: new Date().toISOString(),
      },
    });

  return expiresAt;
}

/**
 * Return a cached, still-valid ephemeral key + certificate for a user/profile,
 * or null if none exists or it has (nearly) expired.
 */
export async function getVaultCert(
  userId: string,
  profileId: number,
): Promise<{ privateKey: string; sshCert: string } | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(vaultTokens)
    .where(
      and(eq(vaultTokens.userId, userId), eq(vaultTokens.profileId, profileId)),
    )
    .limit(1);

  if (!rows || rows.length === 0) return null;
  const row = rows[0];

  const expiresMs = new Date(row.expiresAt).getTime();
  if (expiresMs - EXPIRY_SKEW_SECONDS * 1000 < Date.now()) {
    await deleteVaultCert(userId, profileId);
    return null;
  }

  const userDataKey = UserCrypto.getInstance().getUserDataKey(userId);
  if (!userDataKey) {
    throw new Error("User data key not found");
  }

  const recordId = cacheRecordId(userId, profileId);
  const sshCert = FieldCrypto.decryptField(
    row.sshCert,
    userDataKey,
    recordId,
    "ssh_cert",
  );
  const privateKey = FieldCrypto.decryptField(
    row.privateKey,
    userDataKey,
    recordId,
    "private_key",
  );

  await db
    .update(vaultTokens)
    .set({ lastUsed: new Date().toISOString() })
    .where(
      and(eq(vaultTokens.userId, userId), eq(vaultTokens.profileId, profileId)),
    );

  return { privateKey, sshCert };
}

export async function deleteVaultCert(
  userId: string,
  profileId: number,
): Promise<void> {
  const db = getDb();
  await db
    .delete(vaultTokens)
    .where(
      and(eq(vaultTokens.userId, userId), eq(vaultTokens.profileId, profileId)),
    );
}
