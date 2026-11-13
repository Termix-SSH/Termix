/**
 * The signing chain. An offline root key per tier (two, either one signs)
 * certifies short lived online keys and signs a revocation list. Core ships
 * only the root public keys; everything else is checked against them.
 *
 * Root signatures are SSHSIG (`ssh-keygen -Y sign -n termix-root`) over the
 * canonical JSON of a document's `signed` part, so a root can be a plain
 * ssh-ed25519 file or a FIDO key (sk-ssh-ed25519@openssh.com) with no
 * change here. Online keys are raw Ed25519 and sign a file's sha256.
 *
 * electron/trust-chain.cjs and Termix-Registry scripts/trust/lib.mjs are
 * copies of this file. Keep them in step (a test compares the root keys).
 */

import crypto from "node:crypto";

export type ChainTier = "official" | "community";
export type CertRole = "plugins" | "releases";

export interface RootKey {
  /** OpenSSH fingerprint, like ssh-keygen -l shows. */
  id: string;
  /** One line of an OpenSSH .pub file. */
  publicKey: string;
}

export const ROOT_NAMESPACE = "termix-root";

export const ROOT_KEYS: Readonly<Record<ChainTier, readonly RootKey[]>> = {
  official: [
    {
      id: "SHA256:a549NEiGOOvwpBvYPZno6/bgGsdTarnF+ExL9UmPQRk",
      publicKey:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE6F2K/vrxL3/nimnv5I3MqvNeGMwZFPmMGQatJnblCG",
    },
    {
      id: "SHA256:CtQKKIHB6UaIt2pSOAXwAPpkczI1Bqbual66doeqeoc",
      publicKey:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEpzjNZkl3hv0mG3hOBRBM+rPbrr79HWGl9kDmXpg6EL",
    },
  ],
  community: [
    {
      id: "SHA256:SF4INojl+/wyBBec06AfBx6Y5QC+Rl8H0r+WfCrVeuI",
      publicKey:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEN01pGv3zY8R1chnTk5Gge9kPvjann7GXVm18bNtabN",
    },
    {
      id: "SHA256:XVcMEf9p+KYrPeK96DWNM1MBibXS+1IMc9eSlzcq8bw",
      publicKey:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINAQxlDKahICr/G8COELwYnlojOqzgPP/+Bh0zBTYglu",
    },
  ],
};

/** After this, a plugin signed only by a pre-chain key no longer loads. */
export const LEGACY_TRUST_UNTIL = Date.parse("2027-05-01T00:00:00Z");

const CERT_TYPE = "termix-key-cert";
const REVOCATIONS_TYPE = "termix-revocations";
const SK_ED25519 = "sk-ssh-ed25519@openssh.com";
const SSH_ED25519 = "ssh-ed25519";
const SK_USER_PRESENT = 0x01;
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type Checked<T> = ({ ok: true } & T) | { ok: false; reason: string };

export interface RootSignature {
  keyId: string;
  /** Armored SSHSIG text. */
  sig: string;
}

export interface SignedDocument<T> {
  signed: T;
  signatures: RootSignature[];
}

export interface CertBody {
  type: typeof CERT_TYPE;
  tier: ChainTier;
  role: CertRole;
  keyId: string;
  publicKey: string;
  notBefore: string;
  expires: string;
}

export type KeyCertificate = SignedDocument<CertBody>;

export interface RevocationBody {
  type: typeof REVOCATIONS_TYPE;
  tier: ChainTier;
  version: number;
  issued: string;
  keys: Array<{ keyId: string; reason?: string }>;
  plugins: Array<{ id: string; reason?: string }>;
  versions: Array<{ id: string; version: string; reason?: string }>;
}

export type RevocationList = SignedDocument<RevocationBody>;

/** A file signed by an online key, with the certificate that vouches for it. */
export interface SignatureEnvelope {
  v: 2;
  keyId: string;
  /** Base64 Ed25519 signature over the raw sha256 of the file. */
  sig: string;
  cert: KeyCertificate;
}

/** Sorted keys, no spaces. Only plain JSON values. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("canonical JSON only holds whole numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error(`canonical JSON can't hold a ${typeof value}`);
}

/** First 16 hex chars of the sha256 of a raw base64 Ed25519 key. */
export function onlineKeyId(publicKey: string): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest("hex")
    .slice(0, 16);
}

export function rawPublicKey(base64: string): crypto.KeyObject | null {
  if (typeof base64 !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(base64)) {
    return null;
  }
  try {
    return crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(base64, "base64")]),
      format: "der",
      type: "spki",
    });
  } catch {
    return null;
  }
}

class Reader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}
  bytes(length: number): Buffer {
    if (this.offset + length > this.buf.length) throw new Error("truncated");
    const out = this.buf.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  u8(): number {
    return this.bytes(1)[0];
  }
  u32(): number {
    return this.bytes(4).readUInt32BE(0);
  }
  string(): Buffer {
    return this.bytes(this.u32());
  }
  done(): boolean {
    return this.offset === this.buf.length;
  }
}

function sshString(data: Buffer | string): Buffer {
  const body = typeof data === "string" ? Buffer.from(data) : data;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return Buffer.concat([length, body]);
}

interface SshKey {
  type: string;
  blob: Buffer;
  ed25519: Buffer;
  application?: Buffer;
}

function parseKeyBlob(blob: Buffer): SshKey {
  const reader = new Reader(blob);
  const type = reader.string().toString("latin1");
  const ed25519 = reader.string();
  if (ed25519.length !== 32) throw new Error("not an Ed25519 key");
  if (type === SSH_ED25519) {
    if (!reader.done()) throw new Error("extra bytes in the key");
    return { type, blob, ed25519 };
  }
  if (type === SK_ED25519) {
    const application = reader.string();
    if (!reader.done()) throw new Error("extra bytes in the key");
    return { type, blob, ed25519, application };
  }
  throw new Error(`unsupported key type ${type}`);
}

/** Parses one OpenSSH .pub line (ssh-ed25519 or sk-ssh-ed25519). */
export function parseSshPublicKey(line: string): SshKey {
  const [type, base64] = String(line).trim().split(/\s+/);
  const key = parseKeyBlob(Buffer.from(base64 ?? "", "base64"));
  if (key.type !== type) throw new Error("key type does not match its data");
  return key;
}

export function sshFingerprint(line: string): string {
  const { blob } = parseSshPublicKey(line);
  return `SHA256:${crypto
    .createHash("sha256")
    .update(blob)
    .digest("base64")
    .replace(/=+$/, "")}`;
}

function ed25519Verify(raw: Buffer, data: Buffer, signature: Buffer): boolean {
  const key = rawPublicKey(raw.toString("base64"));
  return key !== null && crypto.verify(null, data, key, signature);
}

/**
 * Checks an armored SSHSIG over `message` against the given keys. Returns
 * the fingerprint of the key that made it.
 */
export function verifySshSignature(
  armored: string,
  message: Buffer,
  keys: readonly RootKey[],
  namespace = ROOT_NAMESPACE,
): Checked<{ keyId: string }> {
  try {
    const text = String(armored).trim();
    const match =
      /^-----BEGIN SSH SIGNATURE-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END SSH SIGNATURE-----$/.exec(
        text,
      );
    if (!match) return { ok: false, reason: "not an SSH signature" };
    const reader = new Reader(
      Buffer.from(match[1].replace(/\s+/g, ""), "base64"),
    );
    if (reader.bytes(6).toString("latin1") !== "SSHSIG") {
      return { ok: false, reason: "not an SSH signature" };
    }
    if (reader.u32() !== 1) {
      return { ok: false, reason: "unsupported SSH signature version" };
    }
    const keyBlob = reader.string();
    const ns = reader.string();
    const reserved = reader.string();
    const hashAlg = reader.string().toString("latin1");
    const sigBlob = reader.string();
    if (!reader.done())
      return { ok: false, reason: "extra bytes in the signature" };
    if (ns.toString("utf8") !== namespace) {
      return { ok: false, reason: "signature is for another purpose" };
    }
    if (hashAlg !== "sha256" && hashAlg !== "sha512") {
      return { ok: false, reason: "unsupported hash in the signature" };
    }

    const root = keys.find((candidate) => {
      try {
        return parseSshPublicKey(candidate.publicKey).blob.equals(keyBlob);
      } catch {
        return false;
      }
    });
    if (!root)
      return { ok: false, reason: "signed by a key that is not a root" };
    const key = parseKeyBlob(keyBlob);

    const signedData = Buffer.concat([
      Buffer.from("SSHSIG"),
      sshString(ns),
      sshString(reserved),
      sshString(hashAlg),
      sshString(crypto.createHash(hashAlg).update(message).digest()),
    ]);

    const sig = new Reader(sigBlob);
    const sigType = sig.string().toString("latin1");
    const raw = sig.string();
    if (sigType !== key.type || raw.length !== 64) {
      return { ok: false, reason: "signature does not match the key type" };
    }
    let data = signedData;
    if (key.type === SK_ED25519) {
      const flags = sig.u8();
      const counter = sig.u32();
      if ((flags & SK_USER_PRESENT) === 0) {
        return { ok: false, reason: "security key was not touched" };
      }
      const counterBytes = Buffer.alloc(4);
      counterBytes.writeUInt32BE(counter, 0);
      data = Buffer.concat([
        crypto.createHash("sha256").update(key.application!).digest(),
        Buffer.from([flags]),
        counterBytes,
        crypto.createHash("sha256").update(signedData).digest(),
      ]);
    }
    if (!sig.done())
      return { ok: false, reason: "extra bytes in the signature" };
    if (!ed25519Verify(key.ed25519, data, raw)) {
      return { ok: false, reason: "root signature does not match" };
    }
    return { ok: true, keyId: root.id };
  } catch {
    return { ok: false, reason: "signature could not be read" };
  }
}

/** Roots of a tier that a revocation list has not revoked. */
export function liveRoots(
  tier: ChainTier,
  revokedKeys: ReadonlySet<string>,
  roots: Readonly<Record<ChainTier, readonly RootKey[]>> = ROOT_KEYS,
): RootKey[] {
  return roots[tier].filter((root) => !revokedKeys.has(root.id));
}

/** One good signature from a live root of the tier is enough. */
export function verifyRootSigned(
  doc: SignedDocument<unknown>,
  roots: readonly RootKey[],
): Checked<{ rootId: string }> {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.signatures)) {
    return { ok: false, reason: "document has no signatures" };
  }
  if (roots.length === 0)
    return { ok: false, reason: "no root key to check with" };
  let message: Buffer;
  try {
    message = Buffer.from(canonicalJson(doc.signed), "utf8");
  } catch {
    return { ok: false, reason: "document is not plain JSON" };
  }
  let reason = "no root signature";
  for (const entry of doc.signatures) {
    const result = verifySshSignature(entry?.sig, message, roots);
    if (result.ok === true) return { ok: true, rootId: result.keyId };
    reason = result.reason;
  }
  return { ok: false, reason };
}

export interface CertCheck {
  tier: ChainTier;
  role: CertRole;
  /** Download time checks dates; an installed plugin already passed them. */
  checkDates: boolean;
  now?: number;
  revokedKeys?: ReadonlySet<string>;
  roots?: Readonly<Record<ChainTier, readonly RootKey[]>>;
}

export function verifyCertificate(
  cert: KeyCertificate,
  check: CertCheck,
): Checked<{ keyId: string; publicKey: crypto.KeyObject; rootId: string }> {
  const body = cert?.signed;
  if (!body || body.type !== CERT_TYPE) {
    return { ok: false, reason: "not a key certificate" };
  }
  if (body.tier !== check.tier) {
    return {
      ok: false,
      reason: `certificate is for the ${String(body.tier)} tier`,
    };
  }
  if (body.role !== check.role) {
    return { ok: false, reason: `certificate is for ${String(body.role)}` };
  }
  const publicKey = rawPublicKey(body.publicKey);
  if (!publicKey || onlineKeyId(body.publicKey) !== body.keyId) {
    return { ok: false, reason: "certificate key is not valid" };
  }
  const revoked = check.revokedKeys ?? new Set<string>();
  if (revoked.has(body.keyId)) {
    return { ok: false, reason: `signing key ${body.keyId} is revoked` };
  }
  const roots = liveRoots(check.tier, revoked, check.roots);
  const signed = verifyRootSigned(cert, roots);
  if (signed.ok === false) return { ok: false, reason: signed.reason };
  if (check.checkDates) {
    const now = check.now ?? Date.now();
    const notBefore = Date.parse(body.notBefore);
    const expires = Date.parse(body.expires);
    if (!Number.isFinite(notBefore) || !Number.isFinite(expires)) {
      return { ok: false, reason: "certificate dates are not valid" };
    }
    if (now < notBefore)
      return { ok: false, reason: "certificate is not valid yet" };
    if (now >= expires) return { ok: false, reason: "certificate has expired" };
  }
  return { ok: true, keyId: body.keyId, publicKey, rootId: signed.rootId };
}

/** Checks a signature envelope over a file's sha256 (raw bytes). */
export function verifyEnvelope(
  digest: Buffer,
  envelope: SignatureEnvelope,
  check: CertCheck,
): Checked<{ keyId: string; rootId: string }> {
  if (!envelope || envelope.v !== 2 || typeof envelope.sig !== "string") {
    return { ok: false, reason: "signature file is not valid" };
  }
  const cert = verifyCertificate(envelope.cert, check);
  if (cert.ok === false) return { ok: false, reason: cert.reason };
  if (envelope.keyId !== cert.keyId) {
    return { ok: false, reason: "signature names another key" };
  }
  const sig = Buffer.from(envelope.sig, "base64");
  if (sig.length !== 64 || !crypto.verify(null, digest, cert.publicKey, sig)) {
    return { ok: false, reason: "signature does not match the file" };
  }
  return { ok: true, keyId: cert.keyId, rootId: cert.rootId };
}

/** Reads a .sig file: a JSON envelope, or null for a plain legacy one. */
export function parseEnvelope(text: string): SignatureEnvelope | null {
  const trimmed = String(text).trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as SignatureEnvelope;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function list<T>(
  value: unknown,
  keep: (item: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      item && typeof item === "object"
        ? keep(item as Record<string, unknown>)
        : null,
    )
    .filter((item): item is T => item !== null);
}

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

/**
 * Checks a revocation list. Its own revoked roots can't sign it, so the
 * backup root can revoke a lost primary and keep signing.
 */
export function verifyRevocationList(
  doc: RevocationList,
  tier: ChainTier,
  roots: Readonly<Record<ChainTier, readonly RootKey[]>> = ROOT_KEYS,
  /** Keys an earlier list revoked: a root on it never signs again. */
  alreadyRevoked: ReadonlySet<string> = new Set(),
): Checked<{ list: RevocationBody }> {
  const body = doc?.signed;
  if (!body || body.type !== REVOCATIONS_TYPE || body.tier !== tier) {
    return { ok: false, reason: "not a revocation list for this tier" };
  }
  if (!Number.isSafeInteger(body.version) || body.version < 1) {
    return { ok: false, reason: "revocation list has no valid version" };
  }
  const revokedKeys = new Set([
    ...alreadyRevoked,
    ...list(body.keys, (k) => str(k.keyId) ?? null),
  ]);
  const signed = verifyRootSigned(doc, liveRoots(tier, revokedKeys, roots));
  if (signed.ok === false) return { ok: false, reason: signed.reason };
  return {
    ok: true,
    list: {
      type: REVOCATIONS_TYPE,
      tier,
      version: body.version,
      issued: str(body.issued) ?? "",
      keys: list(body.keys, (k) =>
        str(k.keyId) ? { keyId: str(k.keyId)!, reason: str(k.reason) } : null,
      ),
      plugins: list(body.plugins, (p) =>
        str(p.id) ? { id: str(p.id)!, reason: str(p.reason) } : null,
      ),
      versions: list(body.versions, (v) =>
        str(v.id) && str(v.version)
          ? { id: str(v.id)!, version: str(v.version)!, reason: str(v.reason) }
          : null,
      ),
    },
  };
}
