import fs from "node:fs";
import path from "node:path";
import {
  SIGNING_KEY_ENV,
  generateKeyPair,
  loadPrivateKey,
  sha256,
  signArtifact,
  verifyArtifact,
} from "../lib/signing.mjs";

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} needs a value`);
  return value;
}

function artifactArg(cwd, args) {
  const file = args.find((arg) => arg.endsWith(".tmxplug"));
  if (!file) throw new Error("Pass the .tmxplug file to use");
  const full = path.resolve(cwd, file);
  if (!fs.existsSync(full)) throw new Error(`${file} does not exist`);
  return full;
}

/** Writes <file>.sig: base64 Ed25519 over the sha256 of the .tmxplug. */
export async function sign({ cwd, args = [], env = process.env }) {
  const file = artifactArg(cwd, args);
  const key = loadPrivateKey(env[SIGNING_KEY_ENV]);
  const buffer = fs.readFileSync(file);
  const signature = signArtifact(buffer, key);
  fs.writeFileSync(`${file}.sig`, `${signature}\n`);
  console.log(`signed ${path.basename(file)}`);
  console.log(`  sha256     ${sha256(buffer).toString("hex")}`);
  console.log(`  signature  ${signature}`);
  return signature;
}

/** Checks a .tmxplug against its .sig and one or more public keys. */
export async function verify({ cwd, args = [] }) {
  const file = artifactArg(cwd, args);
  const keys = (readOption(args, "--key") ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  if (keys.length === 0) throw new Error("Pass --key <base64 public key>");
  const sigFile = readOption(args, "--sig") ?? `${file}.sig`;
  if (!fs.existsSync(sigFile)) throw new Error(`${sigFile} does not exist`);

  const matched = verifyArtifact(
    fs.readFileSync(file),
    fs.readFileSync(sigFile, "utf8"),
    keys,
  );
  if (!matched)
    throw new Error(`${path.basename(file)}: signature is not valid`);
  console.log(`ok  ${path.basename(file)} signed by key ${matched}`);
  return matched;
}

/**
 * Writes a new private key to a file and prints the public half. The
 * private key never goes to stdout, so it does not end up in a CI log.
 */
export async function keygen({ cwd, args = [] }) {
  const outDir = path.resolve(cwd, readOption(args, "--out") ?? ".");
  const keyFile = path.join(outDir, "termix-plugin-signing.key");
  if (fs.existsSync(keyFile)) {
    throw new Error(`${keyFile} already exists; move it first`);
  }
  const pair = generateKeyPair();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(keyFile, `${pair.privateKey}\n`, { mode: 0o600 });
  console.log(`private key  ${keyFile}`);
  console.log(`public key   ${pair.publicKey}`);
  console.log(`key id       ${pair.keyId}`);
  console.log(
    `Store the private key as ${SIGNING_KEY_ENV}, then delete the file.`,
  );
  return { keyFile, publicKey: pair.publicKey, keyId: pair.keyId };
}
