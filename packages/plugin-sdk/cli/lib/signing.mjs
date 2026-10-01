import crypto from "node:crypto";

/** The env var that holds the base64 PKCS8 private key. Never commit it. */
export const SIGNING_KEY_ENV = "TERMIX_PLUGIN_SIGNING_KEY";

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest();
}

export function publicKeyFromRaw(base64) {
  const raw = Buffer.from(base64.trim(), "base64");
  if (raw.length !== 32) throw new Error("A public key is 32 bytes, base64");
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

export function rawPublicKey(keyObject) {
  const der = keyObject.export({ format: "der", type: "spki" });
  return der.subarray(SPKI_PREFIX.length).toString("base64");
}

/** First 16 hex chars of the sha256 of the raw public key. */
export function keyId(publicKeyBase64) {
  return sha256(Buffer.from(publicKeyBase64, "base64"))
    .toString("hex")
    .slice(0, 16);
}

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicBase64 = rawPublicKey(publicKey);
  return {
    publicKey: publicBase64,
    privateKey: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
    keyId: keyId(publicBase64),
  };
}

/** Accepts base64 PKCS8 DER (what keygen writes) or a PEM block. */
export function loadPrivateKey(value) {
  if (!value || !value.trim()) {
    throw new Error(`${SIGNING_KEY_ENV} is not set`);
  }
  const trimmed = value.trim();
  const key = trimmed.startsWith("-----BEGIN")
    ? crypto.createPrivateKey(trimmed)
    : crypto.createPrivateKey({
        key: Buffer.from(trimmed, "base64"),
        format: "der",
        type: "pkcs8",
      });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("The signing key must be an Ed25519 key");
  }
  return key;
}

/** Ed25519 over the raw 32-byte sha256 of the artifact, base64. */
export function signArtifact(buffer, privateKey) {
  return crypto.sign(null, sha256(buffer), privateKey).toString("base64");
}

/** The id of the first key that verifies the signature, or null. */
export function verifyArtifact(buffer, signatureBase64, publicKeys) {
  const digest = sha256(buffer);
  const signature = Buffer.from(signatureBase64.trim(), "base64");
  if (signature.length !== 64) return null;
  for (const key of publicKeys) {
    try {
      if (crypto.verify(null, digest, publicKeyFromRaw(key), signature)) {
        return keyId(key);
      }
    } catch {
      // A malformed key is just a key that does not match.
    }
  }
  return null;
}
