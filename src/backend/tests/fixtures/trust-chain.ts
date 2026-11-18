/**
 * Builds a throwaway root chain for tests: SSH root keys that sign the same
 * SSHSIG ssh-keygen makes, online keys, certificates, revocation lists and
 * signature envelopes.
 */

import crypto from "node:crypto";
import {
  canonicalJson,
  onlineKeyId,
  type CertBody,
  type CertRole,
  type ChainTier,
  type KeyCertificate,
  type RevocationBody,
  type RevocationList,
  type RootKey,
  type SignatureEnvelope,
} from "../../plugins/trust-chain.js";

function sshString(data: Buffer | string): Buffer {
  const body = typeof data === "string" ? Buffer.from(data) : data;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return Buffer.concat([length, body]);
}

function rawOf(publicKey: crypto.KeyObject): Buffer {
  return publicKey.export({ format: "der", type: "spki" }).subarray(12);
}

export interface TestRoot {
  key: RootKey;
  /** Armored SSHSIG over message, like ssh-keygen -Y sign. */
  sign(message: Buffer, options?: SignOptions): string;
}

export interface SignOptions {
  namespace?: string;
  hash?: "sha256" | "sha512";
  /** sk keys only: the flags byte (0x01 = touched). */
  flags?: number;
}

/** An ssh-ed25519 root, or an sk-ssh-ed25519 one with sk: true. */
export function makeRoot(options: { sk?: boolean } = {}): TestRoot {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = rawOf(publicKey);
  const type = options.sk ? "sk-ssh-ed25519@openssh.com" : "ssh-ed25519";
  const application = Buffer.from("ssh:");
  const blob = Buffer.concat([
    sshString(type),
    sshString(raw),
    ...(options.sk ? [sshString(application)] : []),
  ]);
  const line = `${type} ${blob.toString("base64")}`;
  const id = `SHA256:${crypto
    .createHash("sha256")
    .update(blob)
    .digest("base64")
    .replace(/=+$/, "")}`;

  const sign = (message: Buffer, opts: SignOptions = {}): string => {
    const namespace = opts.namespace ?? "termix-root";
    const hash = opts.hash ?? "sha512";
    const signedData = Buffer.concat([
      Buffer.from("SSHSIG"),
      sshString(namespace),
      sshString(""),
      sshString(hash),
      sshString(crypto.createHash(hash).update(message).digest()),
    ]);
    let sigBlob: Buffer;
    if (options.sk) {
      const flags = opts.flags ?? 0x01;
      const counter = Buffer.alloc(4);
      counter.writeUInt32BE(7, 0);
      const data = Buffer.concat([
        crypto.createHash("sha256").update(application).digest(),
        Buffer.from([flags]),
        counter,
        crypto.createHash("sha256").update(signedData).digest(),
      ]);
      sigBlob = Buffer.concat([
        sshString(type),
        sshString(crypto.sign(null, data, privateKey)),
        Buffer.from([flags]),
        counter,
      ]);
    } else {
      sigBlob = Buffer.concat([
        sshString(type),
        sshString(crypto.sign(null, signedData, privateKey)),
      ]);
    }
    const version = Buffer.alloc(4);
    version.writeUInt32BE(1, 0);
    const outer = Buffer.concat([
      Buffer.from("SSHSIG"),
      version,
      sshString(blob),
      sshString(namespace),
      sshString(""),
      sshString(hash),
      sshString(sigBlob),
    ]).toString("base64");
    const lines = outer.match(/.{1,70}/g) ?? [];
    return `-----BEGIN SSH SIGNATURE-----\n${lines.join("\n")}\n-----END SSH SIGNATURE-----\n`;
  };

  return { key: { id, publicKey: line }, sign };
}

export interface TestOnlineKey {
  privateKey: crypto.KeyObject;
  publicKey: string;
  keyId: string;
}

export function makeOnlineKey(): TestOnlineKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = rawOf(publicKey).toString("base64");
  return { privateKey, publicKey: raw, keyId: onlineKeyId(raw) };
}

/** Root signs canonical(signed). */
export function rootSign<T>(
  signed: T,
  ...roots: TestRoot[]
): { signed: T; signatures: Array<{ keyId: string; sig: string }> } {
  const message = Buffer.from(canonicalJson(signed));
  return {
    signed,
    signatures: roots.map((root) => ({
      keyId: root.key.id,
      sig: root.sign(message),
    })),
  };
}

export function makeCert(
  root: TestRoot,
  online: TestOnlineKey,
  overrides: Partial<CertBody> & { tier?: ChainTier; role?: CertRole } = {},
): KeyCertificate {
  return rootSign<CertBody>(
    {
      type: "termix-key-cert",
      tier: "official",
      role: "plugins",
      keyId: online.keyId,
      publicKey: online.publicKey,
      notBefore: "2026-01-01T00:00:00Z",
      expires: "2099-01-01T00:00:00Z",
      ...overrides,
    },
    root,
  );
}

export function makeRevocations(
  root: TestRoot,
  overrides: Partial<RevocationBody> = {},
): RevocationList {
  return rootSign<RevocationBody>(
    {
      type: "termix-revocations",
      tier: "official",
      version: 1,
      issued: "2026-11-12T00:00:00Z",
      keys: [],
      plugins: [],
      versions: [],
      ...overrides,
    },
    root,
  );
}

/** Signs a file's sha256 with an online key and wraps it with its cert. */
export function envelopeFor(
  data: Buffer,
  online: TestOnlineKey,
  cert: KeyCertificate,
): SignatureEnvelope {
  const digest = crypto.createHash("sha256").update(data).digest();
  return {
    v: 2,
    keyId: online.keyId,
    sig: crypto.sign(null, digest, online.privateKey).toString("base64"),
    cert,
  };
}

/** Root lists for both tiers, for setTrustRootsForTests. */
export function rootsFor(
  official: TestRoot[],
  community: TestRoot[] = [],
): Record<ChainTier, RootKey[]> {
  return {
    official: official.map((root) => root.key),
    community: community.map((root) => root.key),
  };
}
