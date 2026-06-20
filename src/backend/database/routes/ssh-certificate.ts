import crypto from "crypto";

// Minimal OpenSSH ed25519 user-certificate signer + per-user CA generation.
// Implemented in pure Node so we never shell out or move private keys to disk.
// Format reference: PROTOCOL.certkeys (ssh-ed25519-cert-v01@openssh.com).

const ED25519 = "ssh-ed25519";
const CERT_TYPE = "ssh-ed25519-cert-v01@openssh.com";
const SSH2_CERT_TYPE_USER = 1;

// Standard login extensions OpenSSH grants by default; must be name-sorted.
const DEFAULT_EXTENSIONS = [
  "permit-X11-forwarding",
  "permit-agent-forwarding",
  "permit-port-forwarding",
  "permit-pty",
  "permit-user-rc",
];

// --- SSH wire-format primitives -------------------------------------------

function sshString(value: Buffer | string): Buffer {
  const buf = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

function sshUint32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function sshUint64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(n, 0);
  return b;
}

function ed25519PublicBlob(raw32: Buffer): Buffer {
  return Buffer.concat([sshString(ED25519), sshString(raw32)]);
}

/** Extract the 32-byte raw ed25519 key from an `ssh-ed25519 <base64>` line. */
export function ed25519RawFromLine(line: string): Buffer | null {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== ED25519 || !parts[1]) return null;
  let blob: Buffer;
  try {
    blob = Buffer.from(parts[1], "base64");
  } catch {
    return null;
  }
  try {
    let off = 0;
    const typeLen = blob.readUInt32BE(off);
    off += 4;
    if (blob.toString("utf8", off, off + typeLen) !== ED25519) return null;
    off += typeLen;
    const keyLen = blob.readUInt32BE(off);
    off += 4;
    const pk = blob.subarray(off, off + keyLen);
    return pk.length === 32 ? pk : null;
  } catch {
    return null;
  }
}

// --- CA generation ---------------------------------------------------------

export interface GeneratedCa {
  publicKeyLine: string; // "ssh-ed25519 <base64>"
  privateKeyPem: string; // PKCS#8 PEM (to be stored encrypted)
}

export function generateCa(): GeneratedCa {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  const raw = Buffer.from(jwk.x, "base64url");
  const publicKeyLine = `${ED25519} ${ed25519PublicBlob(raw).toString("base64")}`;
  const privateKeyPem = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  return { publicKeyLine, privateKeyPem };
}

// --- Certificate signing ---------------------------------------------------

export interface SignCertOptions {
  userPublicKeyLine: string; // ed25519 public key to certify
  caPrivateKeyPem: string;
  caPublicKeyLine: string;
  keyId: string;
  principals: string[]; // empty = valid for all usernames
  validAfter: number; // unix seconds
  validBefore: number; // unix seconds
  serial?: bigint;
}

/**
 * Sign an ed25519 user public key into an OpenSSH user certificate.
 * Returns the certificate line, or null if the inputs aren't ed25519.
 */
export function signUserCertificate(opts: SignCertOptions): string | null {
  const pk = ed25519RawFromLine(opts.userPublicKeyLine);
  const caRaw = ed25519RawFromLine(opts.caPublicKeyLine);
  if (!pk || !caRaw) return null;

  const signatureKey = ed25519PublicBlob(caRaw);
  const principals = Buffer.concat(opts.principals.map((p) => sshString(p)));
  const extensions = Buffer.concat(
    [...DEFAULT_EXTENSIONS]
      .sort()
      .map((name) => Buffer.concat([sshString(name), sshString("")])),
  );

  // Everything up to (not including) the signature — this is what gets signed.
  const body = Buffer.concat([
    sshString(CERT_TYPE),
    sshString(crypto.randomBytes(32)), // nonce
    sshString(pk),
    sshUint64(opts.serial ?? 0n),
    sshUint32(SSH2_CERT_TYPE_USER),
    sshString(opts.keyId),
    sshString(principals),
    sshUint64(BigInt(opts.validAfter)),
    sshUint64(BigInt(opts.validBefore)),
    sshString(Buffer.alloc(0)), // critical options (none)
    sshString(extensions),
    sshString(Buffer.alloc(0)), // reserved
    sshString(signatureKey),
  ]);

  const caKey = crypto.createPrivateKey({
    key: opts.caPrivateKeyPem,
    format: "pem",
    type: "pkcs8",
  });
  const rawSig = crypto.sign(null, body, caKey); // ed25519 -> 64 bytes
  const signature = Buffer.concat([sshString(ED25519), sshString(rawSig)]);

  const cert = Buffer.concat([body, sshString(signature)]);
  return `${CERT_TYPE} ${cert.toString("base64")} ${opts.keyId}`;
}
