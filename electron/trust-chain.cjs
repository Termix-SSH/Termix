// Copy of src/backend/plugins/trust-chain.ts for the desktop updater, which
// runs in the main process and can't load backend code. Keep them in step;
// a test checks the root keys match.
const crypto = require("node:crypto");

const ROOT_NAMESPACE = "termix-root";

const ROOT_KEYS = {
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

const CERT_TYPE = "termix-key-cert";
const REVOCATIONS_TYPE = "termix-revocations";
const SK_ED25519 = "sk-ssh-ed25519@openssh.com";
const SSH_ED25519 = "ssh-ed25519";
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function canonicalJson(value) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("canonical JSON only holds whole numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error(`canonical JSON can't hold a ${typeof value}`);
}

function onlineKeyId(publicKey) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest("hex")
    .slice(0, 16);
}

function rawPublicKey(base64) {
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

function reader(buf) {
  let offset = 0;
  const bytes = (length) => {
    if (offset + length > buf.length) throw new Error("truncated");
    const out = buf.subarray(offset, offset + length);
    offset += length;
    return out;
  };
  const u32 = () => bytes(4).readUInt32BE(0);
  return {
    bytes,
    u8: () => bytes(1)[0],
    u32,
    string: () => bytes(u32()),
    done: () => offset === buf.length,
  };
}

function sshString(data) {
  const body = typeof data === "string" ? Buffer.from(data) : data;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return Buffer.concat([length, body]);
}

function parseKeyBlob(blob) {
  const r = reader(blob);
  const type = r.string().toString("latin1");
  const ed25519 = r.string();
  if (ed25519.length !== 32) throw new Error("not an Ed25519 key");
  if (type === SSH_ED25519) {
    if (!r.done()) throw new Error("extra bytes in the key");
    return { type, blob, ed25519 };
  }
  if (type === SK_ED25519) {
    const application = r.string();
    if (!r.done()) throw new Error("extra bytes in the key");
    return { type, blob, ed25519, application };
  }
  throw new Error(`unsupported key type ${type}`);
}

function parseSshPublicKey(line) {
  const [type, base64] = String(line).trim().split(/\s+/);
  const key = parseKeyBlob(Buffer.from(base64 || "", "base64"));
  if (key.type !== type) throw new Error("key type does not match its data");
  return key;
}

function verifySshSignature(
  armored,
  message,
  keys,
  namespace = ROOT_NAMESPACE,
) {
  try {
    const match =
      /^-----BEGIN SSH SIGNATURE-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END SSH SIGNATURE-----$/.exec(
        String(armored).trim(),
      );
    if (!match) return { ok: false, reason: "not an SSH signature" };
    const r = reader(Buffer.from(match[1].replace(/\s+/g, ""), "base64"));
    if (r.bytes(6).toString("latin1") !== "SSHSIG") {
      return { ok: false, reason: "not an SSH signature" };
    }
    if (r.u32() !== 1)
      return { ok: false, reason: "unsupported SSH signature version" };
    const keyBlob = r.string();
    const ns = r.string();
    const reserved = r.string();
    const hashAlg = r.string().toString("latin1");
    const sigBlob = r.string();
    if (!r.done()) return { ok: false, reason: "extra bytes in the signature" };
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
    const sig = reader(sigBlob);
    const sigType = sig.string().toString("latin1");
    const raw = sig.string();
    if (sigType !== key.type || raw.length !== 64) {
      return { ok: false, reason: "signature does not match the key type" };
    }
    let data = signedData;
    if (key.type === SK_ED25519) {
      const flags = sig.u8();
      const counter = sig.u32();
      if ((flags & 0x01) === 0) {
        return { ok: false, reason: "security key was not touched" };
      }
      const counterBytes = Buffer.alloc(4);
      counterBytes.writeUInt32BE(counter, 0);
      data = Buffer.concat([
        crypto.createHash("sha256").update(key.application).digest(),
        Buffer.from([flags]),
        counterBytes,
        crypto.createHash("sha256").update(signedData).digest(),
      ]);
    }
    if (!sig.done())
      return { ok: false, reason: "extra bytes in the signature" };
    const publicKey = rawPublicKey(key.ed25519.toString("base64"));
    if (!publicKey || !crypto.verify(null, data, publicKey, raw)) {
      return { ok: false, reason: "root signature does not match" };
    }
    return { ok: true, keyId: root.id };
  } catch {
    return { ok: false, reason: "signature could not be read" };
  }
}

function liveRoots(tier, revokedKeys, roots = ROOT_KEYS) {
  return roots[tier].filter((root) => !revokedKeys.has(root.id));
}

function verifyRootSigned(doc, roots) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.signatures)) {
    return { ok: false, reason: "document has no signatures" };
  }
  if (roots.length === 0)
    return { ok: false, reason: "no root key to check with" };
  let message;
  try {
    message = Buffer.from(canonicalJson(doc.signed), "utf8");
  } catch {
    return { ok: false, reason: "document is not plain JSON" };
  }
  let reason = "no root signature";
  for (const entry of doc.signatures) {
    const result = verifySshSignature(entry && entry.sig, message, roots);
    if (result.ok) return { ok: true, rootId: result.keyId };
    reason = result.reason;
  }
  return { ok: false, reason };
}

function verifyCertificate(cert, check) {
  const body = cert && cert.signed;
  if (!body || body.type !== CERT_TYPE)
    return { ok: false, reason: "not a key certificate" };
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
  const revoked = check.revokedKeys || new Set();
  if (revoked.has(body.keyId)) {
    return { ok: false, reason: `signing key ${body.keyId} is revoked` };
  }
  const signed = verifyRootSigned(
    cert,
    liveRoots(check.tier, revoked, check.roots),
  );
  if (!signed.ok) return signed;
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

/** Checks an envelope over a file; like plugins, it signs the file's sha256. */
function verifyEnvelopeFor(data, envelope, check) {
  if (!envelope || envelope.v !== 2 || typeof envelope.sig !== "string") {
    return { ok: false, reason: "signature file is not valid" };
  }
  const cert = verifyCertificate(envelope.cert, check);
  if (!cert.ok) return cert;
  if (envelope.keyId !== cert.keyId)
    return { ok: false, reason: "signature names another key" };
  const sig = Buffer.from(envelope.sig, "base64");
  const digest = crypto.createHash("sha256").update(data).digest();
  if (sig.length !== 64 || !crypto.verify(null, digest, cert.publicKey, sig)) {
    return { ok: false, reason: "signature does not match the file" };
  }
  return { ok: true, keyId: cert.keyId, rootId: cert.rootId };
}

/** Revoked key ids from an official revocation list, or null when not valid. */
function revokedKeysFrom(doc, roots = ROOT_KEYS) {
  const body = doc && doc.signed;
  if (!body || body.type !== REVOCATIONS_TYPE || body.tier !== "official")
    return null;
  if (!Number.isSafeInteger(body.version) || body.version < 1) return null;
  const ids = new Set(
    (Array.isArray(body.keys) ? body.keys : [])
      .map((key) => key && key.keyId)
      .filter((id) => typeof id === "string"),
  );
  return verifyRootSigned(doc, liveRoots("official", ids, roots)).ok
    ? ids
    : null;
}

module.exports = {
  ROOT_KEYS,
  ROOT_NAMESPACE,
  canonicalJson,
  onlineKeyId,
  parseSshPublicKey,
  revokedKeysFrom,
  verifyCertificate,
  verifyEnvelopeFor,
  verifyRootSigned,
  verifySshSignature,
};
