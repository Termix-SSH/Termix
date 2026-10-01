import crypto from "node:crypto";

export interface TrustedPluginKey {
  /** First 16 hex chars of the sha256 of the raw public key. */
  id: string;
  /** Raw 32-byte Ed25519 public key, base64. */
  publicKey: string;
  /** The Termix release that started trusting it. */
  addedIn: string;
}

/**
 * The registry signing keys this build trusts. Compile-time on purpose: a
 * key read from a registry index would let whoever serves the index sign
 * anything.
 *
 * Rotation: add the new key here and ship a release, start signing with it,
 * then remove the old key one release cycle later so installs that update
 * late still verify plugins signed before the switch.
 *
 * Add a key with `termix-plugin keygen` (see the Termix-Registry README).
 */
export const TRUSTED_PLUGIN_KEYS: readonly TrustedPluginKey[] = [];

export type ArtifactVerification =
  { ok: true; keyId: string } | { ok: false; reason: string };

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw key follows.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function toPublicKey(base64: string): crypto.KeyObject | null {
  const raw = Buffer.from(base64, "base64");
  if (raw.length !== 32) return null;
  try {
    return crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
  } catch {
    return null;
  }
}

/**
 * Checks that `buffer` hashes to `sha256` (hex) and that `signature`
 * (base64 Ed25519 over the raw digest) was made by a pinned key.
 *
 * `keys` exists for tests. Production callers never pass it.
 */
export function verifyPluginArtifact(
  buffer: Buffer,
  sha256: string,
  signature: string,
  keys: readonly TrustedPluginKey[] = TRUSTED_PLUGIN_KEYS,
): ArtifactVerification {
  const digest = crypto.createHash("sha256").update(buffer).digest();
  const expected = Buffer.from(sha256.trim().toLowerCase(), "hex");
  if (
    expected.length !== digest.length ||
    !crypto.timingSafeEqual(expected, digest)
  ) {
    return { ok: false, reason: "sha256 does not match the file" };
  }

  const sig = Buffer.from(signature.trim(), "base64");
  if (sig.length !== 64) {
    return { ok: false, reason: "signature is not a valid Ed25519 signature" };
  }
  if (keys.length === 0) {
    return { ok: false, reason: "this build trusts no signing keys" };
  }

  for (const key of keys) {
    const publicKey = toPublicKey(key.publicKey);
    if (publicKey && crypto.verify(null, digest, publicKey, sig)) {
      return { ok: true, keyId: key.id };
    }
  }
  return { ok: false, reason: "signature does not match a trusted key" };
}

/** TERMIX_REQUIRE_SIGNED_PLUGINS=true blocks unsigned user plugins. */
export function requireSignedPlugins(): boolean {
  return process.env.TERMIX_REQUIRE_SIGNED_PLUGINS === "true";
}
