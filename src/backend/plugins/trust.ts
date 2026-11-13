import crypto from "node:crypto";
import {
  LEGACY_TRUST_UNTIL,
  ROOT_KEYS,
  parseEnvelope,
  verifyEnvelope,
  type ChainTier,
  type RootKey,
  type SignatureEnvelope,
} from "./trust-chain.js";
import { revokedKeyIds } from "./revocation-state.js";

export interface TrustedPluginKey {
  /** First 16 hex chars of the sha256 of the raw public key. */
  id: string;
  /** Raw 32-byte Ed25519 public key, base64. */
  publicKey: string;
  /** The Termix release that started trusting it. */
  addedIn: string;
}

/**
 * The official key from before the root chain (trust-chain.ts). New
 * downloads need a root certified key; this one only keeps already
 * installed plugins loading until LEGACY_TRUST_UNTIL, so installs have time
 * to pick up chain signatures. Remove it after that date.
 */
export const TRUSTED_PLUGIN_KEYS: readonly TrustedPluginKey[] = [
  {
    id: "ec40e29bcc4986b2",
    publicKey: "rF6ouWTnuLgnZi7yemr+yhZmMxvNMvgro1Mf05IkSGo=",
    addedIn: "26.10.0",
  },
];

/**
 * The community key from before the root chain, kept the same way as the
 * official one. Community plugins are their own tier on purpose: they can
 * never replace a bundled plugin or count as official.
 */
export const COMMUNITY_PLUGIN_KEYS: readonly TrustedPluginKey[] = [
  {
    id: "be5b24ea07b36624",
    publicKey: "LYdHHGJeinCZ7UA8R/o5i1P5W3+dzktTDn5bxp4nPpI=",
    addedIn: "26.10.1",
  },
];

export type KeyTier = "official" | "community" | "custom";

/** Keys of registries an admin added, pinned when they were added. */
let customKeys: readonly TrustedPluginKey[] = [];

export function setCustomPluginKeys(keys: readonly TrustedPluginKey[]): void {
  customKeys = keys.filter((key) => toPublicKey(key.publicKey) !== null);
}

export function getCustomPluginKeys(): readonly TrustedPluginKey[] {
  return customKeys;
}

/** First 16 hex chars of the sha256 of a raw base64 public key. */
export function pluginKeyId(publicKey: string): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest("hex")
    .slice(0, 16);
}

/** Whether a string is a raw base64 Ed25519 public key. */
export function isPluginPublicKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9+/]{43}=$/.test(value) &&
    toPublicKey(value) !== null
  );
}

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

let roots: Readonly<Record<ChainTier, readonly RootKey[]>> = ROOT_KEYS;

/** Test seam: the root keys the chain checks use. */
export function setTrustRootsForTests(
  value: Readonly<Record<ChainTier, readonly RootKey[]>> | null,
): void {
  roots = value ?? ROOT_KEYS;
}

export function trustRoots(): Readonly<Record<ChainTier, readonly RootKey[]>> {
  return roots;
}

/**
 * "download" is a file about to be installed: its certificate must be in
 * date and pre-chain keys are refused. "installed" is a file already on
 * disk: it passed the date check when it came in, and pre-chain keys still
 * count until LEGACY_TRUST_UNTIL.
 */
export type TrustMode = "download" | "installed";

export interface TrustOptions {
  mode?: TrustMode;
  now?: number;
}

export type TrustResult =
  | { ok: true; keyId: string; tier: KeyTier; rootId?: string }
  | { ok: false; reason: string };

/** Whether the pre-chain key of a tier may still vouch for a file. */
export function legacyAllowed(
  tier: ChainTier,
  options: TrustOptions = {},
): boolean {
  if (roots[tier].length === 0) return true;
  if ((options.mode ?? "installed") === "download") return false;
  return (options.now ?? Date.now()) < LEGACY_TRUST_UNTIL;
}

function digestMatches(buffer: Buffer, sha256: string): Buffer | null {
  const digest = crypto.createHash("sha256").update(buffer).digest();
  const expected = Buffer.from(sha256.trim().toLowerCase(), "hex");
  return expected.length === digest.length &&
    crypto.timingSafeEqual(expected, digest)
    ? digest
    : null;
}

/** Checks a chain envelope over a file for one tier. */
export function verifyChainSignature(
  buffer: Buffer,
  sha256: string,
  envelope: SignatureEnvelope,
  tier: ChainTier,
  options: TrustOptions = {},
): TrustResult {
  const digest = digestMatches(buffer, sha256);
  if (!digest) return { ok: false, reason: "sha256 does not match the file" };
  const result = verifyEnvelope(digest, envelope, {
    tier,
    role: "plugins",
    checkDates: (options.mode ?? "installed") === "download",
    now: options.now,
    revokedKeys: revokedKeyIds(tier),
    roots,
  });
  if (result.ok === false) return result;
  return { ok: true, keyId: result.keyId, tier, rootId: result.rootId };
}

/**
 * Checks a .sig (chain envelope or plain legacy signature) against every
 * key this build trusts, official first, and says which tier signed it.
 */
export function verifyAnyTrusted(
  buffer: Buffer,
  sha256: string,
  signature: string,
  options: TrustOptions = {},
): TrustResult {
  const envelope = parseEnvelope(signature);
  if (envelope) {
    const tier = envelope.cert?.signed?.tier;
    if (tier !== "official" && tier !== "community") {
      return { ok: false, reason: "signature names no known tier" };
    }
    return verifyChainSignature(buffer, sha256, envelope, tier, options);
  }

  const tiers: Array<[KeyTier, readonly TrustedPluginKey[]]> = [
    ["official", legacyAllowed("official", options) ? TRUSTED_PLUGIN_KEYS : []],
    [
      "community",
      legacyAllowed("community", options) ? COMMUNITY_PLUGIN_KEYS : [],
    ],
    ["custom", customKeys],
  ];
  let reason = "signature does not match a trusted key";
  for (const [tier, all] of tiers) {
    const revoked = revokedKeyIds(
      tier === "official" ? "official" : "community",
    );
    const keys = all.filter((key) => !revoked.has(key.id));
    if (keys.length === 0) continue;
    const result = verifyPluginArtifact(buffer, sha256, signature, keys);
    if (result.ok === true) return { ok: true, keyId: result.keyId, tier };
    reason = result.reason;
    if (reason !== "signature does not match a trusted key") break;
  }
  if (reason === "signature does not match a trusted key") {
    // Say why a pre-chain signature stopped counting instead of "no match".
    const legacy = verifyPluginArtifact(buffer, sha256, signature, [
      ...TRUSTED_PLUGIN_KEYS,
      ...COMMUNITY_PLUGIN_KEYS,
    ]);
    if (legacy.ok === true) {
      return {
        ok: false,
        reason: revokedKeyIds("community").has(legacy.keyId)
          ? "signed by a revoked key"
          : "signed by a key from before the Termix root, which no longer counts",
      };
    }
  }
  return { ok: false, reason };
}

/** TERMIX_REQUIRE_SIGNED_PLUGINS=true blocks unsigned user plugins. */
export function requireSignedPlugins(): boolean {
  return process.env.TERMIX_REQUIRE_SIGNED_PLUGINS === "true";
}
