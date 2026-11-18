#!/usr/bin/env node
// Signs SHA256SUMS with the release key (TERMIX_RELEASE_SIGNING_KEY) and
// writes SHA256SUMS.sig: the signature plus the certificate the offline
// Termix root gave that key. Refuses when the certificate is missing,
// expired or not for this key, so a release never ships a signature the
// desktop updater would turn down.
//
//   node scripts/sign-sums.cjs --sums <file> --out <file> [--certs <file>] [--dry-run]
//
// --certs reads the certificate list from a file instead of Termix-Registry.
// --dry-run signs with a throwaway key and no certificate, for dry runs only.

const crypto = require("node:crypto");
const fs = require("node:fs");
const { parseArgs } = require("node:util");
const trustChain = require("../electron/trust-chain.cjs");

const CERTS_URL =
  "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/trust/official/certs.json";

function loadPrivateKey(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new Error("TERMIX_RELEASE_SIGNING_KEY is not set");
  const key = trimmed.startsWith("-----BEGIN")
    ? crypto.createPrivateKey(trimmed)
    : crypto.createPrivateKey({
        key: Buffer.from(trimmed, "base64"),
        format: "der",
        type: "pkcs8",
      });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("The release key must be an Ed25519 key");
  }
  return key;
}

function rawPublicKey(privateKey) {
  return crypto
    .createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("base64");
}

/** The envelope for data, after checking the certificate fits the key. */
function signSums(data, privateKey, certs, now = Date.now()) {
  const keyId = trustChain.onlineKeyId(rawPublicKey(privateKey));
  const cert = (Array.isArray(certs) ? certs : []).find(
    (item) =>
      item?.signed?.keyId === keyId && item?.signed?.role === "releases",
  );
  if (!cert) throw new Error(`no release certificate for key ${keyId}`);
  const checked = trustChain.verifyCertificate(cert, {
    tier: "official",
    role: "releases",
    checkDates: true,
    now,
  });
  if (!checked.ok) throw new Error(`release certificate: ${checked.reason}`);
  const digest = crypto.createHash("sha256").update(data).digest();
  return {
    v: 2,
    keyId,
    sig: crypto.sign(null, digest, privateKey).toString("base64"),
    cert,
  };
}

async function readCerts(file) {
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  const response = await fetch(CERTS_URL);
  if (!response.ok) throw new Error(`certificates returned ${response.status}`);
  return response.json();
}

async function main() {
  const { values } = parseArgs({
    options: {
      sums: { type: "string" },
      out: { type: "string" },
      certs: { type: "string" },
      "dry-run": { type: "boolean" },
    },
  });
  if (!values.sums || !values.out) throw new Error("Pass --sums and --out");
  const data = fs.readFileSync(values.sums);
  let envelope;
  if (values["dry-run"]) {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const digest = crypto.createHash("sha256").update(data).digest();
    envelope = {
      v: 2,
      keyId: "dry-run",
      sig: crypto.sign(null, digest, privateKey).toString("base64"),
      cert: null,
    };
  } else {
    envelope = signSums(
      data,
      loadPrivateKey(process.env.TERMIX_RELEASE_SIGNING_KEY),
      await readCerts(values.certs),
    );
  }
  fs.writeFileSync(values.out, `${JSON.stringify(envelope)}\n`);
  console.log(`signed ${values.sums} with key ${envelope.keyId}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { loadPrivateKey, signSums };
