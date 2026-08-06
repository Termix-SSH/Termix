import crypto from "crypto";
import { SystemCrypto } from "./system-crypto.js";

/**
 * Encryption for secrets that belong to the installation rather than to a user.
 *
 * Per-user field encryption (DataCrypto/FieldCrypto) derives its key from the
 * user's DEK, which works for host passwords and SSH keys. It does not work for
 * SSO provider configuration: `sso_providers` has no `userId`, and the OIDC
 * client secret and LDAP bind password must be readable during login — before
 * any user is authenticated, let alone unlocked.
 *
 * Those secrets were previously stored base64-encoded behind an `encoded:`
 * prefix, which is not encryption. This uses the system encryption key, the
 * same one already protecting other installation-level material.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const PREFIX = "sysenc:v1:";
const LEGACY_PREFIX = "encoded:";
/** Written by an older path that base64-encoded behind an "encrypted:" prefix. */
const LEGACY_MISLABELLED_PREFIX = "encrypted:";

export function isSystemEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export async function encryptSystemSecret(plaintext: string): Promise<string> {
  if (!plaintext) return plaintext;
  if (isSystemEncrypted(plaintext)) return plaintext;

  const key = await SystemCrypto.getInstance().getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Reads a stored secret, transparently handling values written before this
 * existed. Legacy values are returned as plaintext so login keeps working; they
 * are upgraded on the next write.
 */
export async function decryptSystemSecret(stored: string): Promise<string> {
  if (!stored) return stored;

  if (!isSystemEncrypted(stored)) {
    for (const legacy of [LEGACY_PREFIX, LEGACY_MISLABELLED_PREFIX]) {
      if (stored.startsWith(legacy)) {
        try {
          return Buffer.from(stored.slice(legacy.length), "base64").toString(
            "utf8",
          );
        } catch {
          return stored;
        }
      }
    }
    // Never encoded at all.
    return stored;
  }

  const [ivPart, tagPart, dataPart] = stored.slice(PREFIX.length).split(":");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Malformed system-encrypted secret");
  }

  const key = await SystemCrypto.getInstance().getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivPart, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Fields inside an SSO provider config that must not be stored readable. */
export const SSO_SECRET_FIELDS = ["client_secret", "bindPassword"] as const;

export async function encryptSsoConfigSecrets(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out = { ...config };
  for (const field of SSO_SECRET_FIELDS) {
    const value = out[field];
    if (typeof value === "string" && value) {
      out[field] = await encryptSystemSecret(value);
    }
  }
  return out;
}

export async function decryptSsoConfigSecrets(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out = { ...config };
  for (const field of SSO_SECRET_FIELDS) {
    const value = out[field];
    if (typeof value === "string" && value) {
      try {
        out[field] = await decryptSystemSecret(value);
      } catch {
        // A secret we cannot read must not take the whole provider down;
        // login will fail with a clearer error downstream.
      }
    }
  }
  return out;
}
