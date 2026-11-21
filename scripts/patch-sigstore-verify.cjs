const fs = require("node:fs");
const path = require("node:path");

// @sigstore/core verifies Rekor and DSSE signatures without naming a hash.
// Node's OpenSSL picks the key's default; the desktop app's BoringSSL throws,
// which sigstore reports as a failed check. Name the same default here.
const original = `function verify(data, key, signature, algorithm) {
    // The try/catch is to work around an issue in Node 14.x where verify throws
    // an error in some scenarios if the signature is invalid.
    try {
        return crypto_1.default.verify(algorithm, data, key, signature);`;
const patched = `function defaultDigest(key) {
    const k = typeof key === "object" && key && "asymmetricKeyType" in key
        ? key
        : crypto_1.default.createPublicKey(key);
    if (k.asymmetricKeyType === "rsa" || k.asymmetricKeyType === "rsa-pss")
        return "sha256";
    if (k.asymmetricKeyType !== "ec")
        return undefined;
    const curve = k.asymmetricKeyDetails && k.asymmetricKeyDetails.namedCurve;
    return curve === "secp384r1" ? "sha384" : curve === "secp521r1" ? "sha512" : "sha256";
}
function verify(data, key, signature, algorithm) {
    // The try/catch is to work around an issue in Node 14.x where verify throws
    // an error in some scenarios if the signature is invalid.
    try {
        return crypto_1.default.verify(algorithm ?? defaultDigest(key), data, key, signature);`;

function patchSigstoreCore(source) {
  if (source.includes(patched)) return source;
  if (!source.includes(original)) {
    throw new Error(
      "@sigstore/core crypto changed; review the default digest patch",
    );
  }
  return source.replace(original, patched);
}

if (require.main === module) {
  const verifyDir = path.dirname(
    require.resolve("@sigstore/verify/package.json"),
  );
  const target = require.resolve("@sigstore/core/dist/crypto.js", {
    paths: [verifyDir],
  });
  const source = fs.readFileSync(target, "utf8");
  const result = patchSigstoreCore(source);
  if (result !== source) fs.writeFileSync(target, result);
  console.log("[patch-sigstore-verify] Signature checks name their hash");
}

module.exports = { patchSigstoreCore };
