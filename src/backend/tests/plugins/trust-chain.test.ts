import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import {
  ROOT_KEYS,
  canonicalJson,
  parseEnvelope,
  sshFingerprint,
  verifyCertificate,
  verifyEnvelope,
  verifyRevocationList,
  verifyRootSigned,
  verifySshSignature,
} from "../../plugins/trust-chain.js";
import {
  envelopeFor,
  makeCert,
  makeOnlineKey,
  makeRevocations,
  makeRoot,
  rootSign,
  rootsFor,
} from "../fixtures/trust-chain.js";

const require = createRequire(import.meta.url);
const electronChain = require("../../../../electron/trust-chain.cjs");

// Made once with OpenSSH 9.7: ssh-keygen -Y sign -n termix-root msg.json,
// with a throwaway key that signs nothing else.
const OPENSSH = {
  key: {
    id: "SHA256:6Y8NZoq+TN9fUFB9eqPof6vNss2IOpcQkwJw8u4MJpg",
    publicKey:
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIL+uO6WAw8CIWsC77JapnWfWjbPRszCToiwov/7qmxw throwaway test root",
  },
  message: '{"a":1,"type":"termix-test"}',
  sig: `-----BEGIN SSH SIGNATURE-----
U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAggv647pYDDwIhawLvslqmdZ9aNs
9GzMJOiLCi//uqbHAAAAALdGVybWl4LXJvb3QAAAAAAAAABnNoYTUxMgAAAFMAAAALc3No
LWVkMjU1MTkAAABA3svXKuOr43hd4Fqcs/D5zgfFMT+f90O9CjmqHNqYvgCQtT7/BDsH4n
ggDZO0uPtnc496Y0e/ESA8Qh3cbWXOAg==
-----END SSH SIGNATURE-----
`,
};

describe("built in root keys", () => {
  it("have ids that match their public keys", () => {
    for (const roots of Object.values(ROOT_KEYS)) {
      expect(roots).toHaveLength(2);
      for (const root of roots) {
        expect(sshFingerprint(root.publicKey)).toBe(root.id);
      }
    }
  });

  it("are the same in the desktop copy", () => {
    expect(electronChain.ROOT_KEYS).toEqual(ROOT_KEYS);
  });

  it("keep the tiers apart", () => {
    const official = new Set(ROOT_KEYS.official.map((root) => root.id));
    for (const root of ROOT_KEYS.community) {
      expect(official.has(root.id)).toBe(false);
    }
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level and drops spaces", () => {
    expect(canonicalJson({ b: 1, a: { d: [true, null], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[true,null]},"b":1}',
    );
  });

  it("refuses values that have no single form", () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
    expect(() => canonicalJson({ a: () => 1 })).toThrow();
  });
});

describe("verifySshSignature", () => {
  it("accepts a signature made by real ssh-keygen", () => {
    const result = verifySshSignature(
      OPENSSH.sig,
      Buffer.from(OPENSSH.message),
      [OPENSSH.key],
    );
    expect(result).toEqual({ ok: true, keyId: OPENSSH.key.id });
    expect(sshFingerprint(OPENSSH.key.publicKey)).toBe(OPENSSH.key.id);
  });

  it("refuses the ssh-keygen signature over other bytes", () => {
    expect(
      verifySshSignature(OPENSSH.sig, Buffer.from(`${OPENSSH.message} `), [
        OPENSSH.key,
      ]).ok,
    ).toBe(false);
  });

  it("accepts both hashes ssh-keygen can use", () => {
    const root = makeRoot();
    const message = Buffer.from("hello");
    for (const hash of ["sha256", "sha512"] as const) {
      expect(
        verifySshSignature(root.sign(message, { hash }), message, [root.key])
          .ok,
      ).toBe(true);
    }
  });

  it("refuses a signature from a key that is not a root", () => {
    const root = makeRoot();
    const other = makeRoot();
    const message = Buffer.from("hello");
    expect(
      verifySshSignature(other.sign(message), message, [root.key]),
    ).toEqual({
      ok: false,
      reason: "signed by a key that is not a root",
    });
  });

  it("refuses a signature made for another namespace", () => {
    const root = makeRoot();
    const message = Buffer.from("hello");
    expect(
      verifySshSignature(root.sign(message, { namespace: "git" }), message, [
        root.key,
      ]),
    ).toEqual({ ok: false, reason: "signature is for another purpose" });
  });

  it("refuses garbage and truncated signatures", () => {
    const root = makeRoot();
    const message = Buffer.from("hello");
    const good = root.sign(message);
    expect(verifySshSignature("nope", message, [root.key]).ok).toBe(false);
    const body = good.split("\n").slice(1, -2).join("");
    const bytes = Buffer.from(body, "base64");
    const cut = `-----BEGIN SSH SIGNATURE-----\n${bytes
      .subarray(0, bytes.length - 10)
      .toString("base64")}\n-----END SSH SIGNATURE-----`;
    expect(verifySshSignature(cut, message, [root.key])).toEqual({
      ok: false,
      reason: "signature could not be read",
    });
  });

  it("accepts a touched security key and refuses an untouched one", () => {
    const root = makeRoot({ sk: true });
    const message = Buffer.from("hello");
    expect(verifySshSignature(root.sign(message), message, [root.key]).ok).toBe(
      true,
    );
    expect(
      verifySshSignature(root.sign(message, { flags: 0x00 }), message, [
        root.key,
      ]),
    ).toEqual({ ok: false, reason: "security key was not touched" });
  });

  it("gives the same answers in the desktop copy", () => {
    const root = makeRoot({ sk: true });
    const message = Buffer.from("hello");
    expect(
      electronChain.verifySshSignature(root.sign(message), message, [root.key])
        .ok,
    ).toBe(true);
    expect(
      electronChain.verifySshSignature(
        OPENSSH.sig,
        Buffer.from(OPENSSH.message),
        [OPENSSH.key],
      ).ok,
    ).toBe(true);
    expect(
      electronChain.verifySshSignature(
        root.sign(message, { flags: 0 }),
        message,
        [root.key],
      ).ok,
    ).toBe(false);
  });
});

describe("verifyRootSigned", () => {
  it("needs one good signature from a listed root", () => {
    const a = makeRoot();
    const b = makeRoot();
    const doc = rootSign({ x: 1 }, b);
    expect(verifyRootSigned(doc, [a.key, b.key])).toEqual({
      ok: true,
      rootId: b.key.id,
    });
    expect(verifyRootSigned(doc, [a.key]).ok).toBe(false);
    expect(verifyRootSigned(doc, []).ok).toBe(false);
  });

  it("refuses a signed document that was changed", () => {
    const root = makeRoot();
    const doc = rootSign({ x: 1 }, root);
    expect(verifyRootSigned({ ...doc, signed: { x: 2 } }, [root.key]).ok).toBe(
      false,
    );
  });

  it("does not care about key order or spacing in the file", () => {
    const root = makeRoot();
    const doc = rootSign({ a: 1, b: 2 }, root);
    const reordered = JSON.parse(
      JSON.stringify(
        { signatures: doc.signatures, signed: { b: 2, a: 1 } },
        null,
        2,
      ),
    );
    expect(verifyRootSigned(reordered, [root.key]).ok).toBe(true);
  });
});

describe("verifyCertificate", () => {
  const root = makeRoot();
  const roots = rootsFor([root]);
  const online = makeOnlineKey();
  const base = {
    tier: "official" as const,
    role: "plugins" as const,
    checkDates: true,
    now: Date.parse("2026-12-01T00:00:00Z"),
    roots,
  };

  it("accepts a cert in date, for the right tier and role", () => {
    const result = verifyCertificate(makeCert(root, online), base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keyId).toBe(online.keyId);
      expect(result.rootId).toBe(root.key.id);
    }
  });

  it("refuses an expired cert at download but not once installed", () => {
    const cert = makeCert(root, online, { expires: "2026-11-30T00:00:00Z" });
    expect(verifyCertificate(cert, base)).toEqual({
      ok: false,
      reason: "certificate has expired",
    });
    expect(verifyCertificate(cert, { ...base, checkDates: false }).ok).toBe(
      true,
    );
  });

  it("refuses a cert that is not valid yet", () => {
    const cert = makeCert(root, online, { notBefore: "2027-01-01T00:00:00Z" });
    expect(verifyCertificate(cert, base)).toEqual({
      ok: false,
      reason: "certificate is not valid yet",
    });
  });

  it("refuses a cert for another role or tier", () => {
    expect(
      verifyCertificate(makeCert(root, online, { role: "releases" }), base).ok,
    ).toBe(false);
    expect(
      verifyCertificate(makeCert(root, online, { tier: "community" }), base).ok,
    ).toBe(false);
  });

  it("refuses a community root certifying an official key", () => {
    const community = makeRoot();
    const cert = makeCert(community, online);
    expect(
      verifyCertificate(cert, {
        ...base,
        roots: rootsFor([root], [community]),
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses a cert whose key id does not belong to its key", () => {
    const other = makeOnlineKey();
    const cert = makeCert(root, online, { keyId: other.keyId });
    expect(verifyCertificate(cert, base)).toEqual({
      ok: false,
      reason: "certificate key is not valid",
    });
  });

  it("refuses a cert for a revoked key or from a revoked root", () => {
    const cert = makeCert(root, online);
    expect(
      verifyCertificate(cert, {
        ...base,
        revokedKeys: new Set([online.keyId]),
      }),
    ).toEqual({ ok: false, reason: `signing key ${online.keyId} is revoked` });
    expect(
      verifyCertificate(cert, { ...base, revokedKeys: new Set([root.key.id]) })
        .ok,
    ).toBe(false);
  });

  it("refuses a cert someone edited after signing", () => {
    const cert = makeCert(root, online);
    const other = makeOnlineKey();
    const edited = {
      ...cert,
      signed: {
        ...cert.signed,
        publicKey: other.publicKey,
        keyId: other.keyId,
      },
    };
    expect(verifyCertificate(edited, base).ok).toBe(false);
  });
});

describe("verifyEnvelope", () => {
  const root = makeRoot();
  const online = makeOnlineKey();
  const cert = makeCert(root, online);
  const file = Buffer.from("plugin bytes");
  const digest = crypto.createHash("sha256").update(file).digest();
  const check = {
    tier: "official" as const,
    role: "plugins" as const,
    checkDates: true,
    roots: rootsFor([root]),
  };

  it("accepts the online key's signature over the file", () => {
    expect(
      verifyEnvelope(digest, envelopeFor(file, online, cert), check),
    ).toEqual({
      ok: true,
      keyId: online.keyId,
      rootId: root.key.id,
    });
  });

  it("refuses a signature over another file", () => {
    const envelope = envelopeFor(Buffer.from("other"), online, cert);
    expect(verifyEnvelope(digest, envelope, check)).toEqual({
      ok: false,
      reason: "signature does not match the file",
    });
  });

  it("refuses a signature by a key the cert does not name", () => {
    const thief = makeOnlineKey();
    const envelope = envelopeFor(file, thief, cert);
    expect(verifyEnvelope(digest, envelope, check).ok).toBe(false);
  });

  it("reads envelopes and leaves plain signatures alone", () => {
    const envelope = envelopeFor(file, online, cert);
    expect(parseEnvelope(JSON.stringify(envelope))).toEqual(envelope);
    expect(parseEnvelope("bm9wZQ==")).toBeNull();
    expect(parseEnvelope("{broken")).toBeNull();
  });
});

describe("verifyRevocationList", () => {
  const a = makeRoot();
  const b = makeRoot();
  const roots = rootsFor([a, b]);

  it("accepts a list one root signed", () => {
    const result = verifyRevocationList(
      makeRevocations(a, { plugins: [{ id: "x", reason: "bad" }] }),
      "official",
      roots,
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.list.plugins).toEqual([{ id: "x", reason: "bad" }]);
  });

  it("refuses a list for the other tier or with no version", () => {
    expect(
      verifyRevocationList(
        makeRevocations(a, { tier: "community" }),
        "official",
        roots,
      ).ok,
    ).toBe(false);
    expect(
      verifyRevocationList(
        makeRevocations(a, { version: 0 }),
        "official",
        roots,
      ).ok,
    ).toBe(false);
  });

  it("lets the backup root revoke a lost primary, and the primary can't sign it", () => {
    const fromBackup = makeRevocations(b, { keys: [{ keyId: a.key.id }] });
    expect(verifyRevocationList(fromBackup, "official", roots).ok).toBe(true);
    const fromPrimary = makeRevocations(a, { keys: [{ keyId: a.key.id }] });
    expect(verifyRevocationList(fromPrimary, "official", roots).ok).toBe(false);
  });

  it("never takes a list from a root an earlier list revoked", () => {
    expect(
      verifyRevocationList(
        makeRevocations(a),
        "official",
        roots,
        new Set([a.key.id]),
      ).ok,
    ).toBe(false);
  });

  it("drops malformed entries instead of failing the list", () => {
    const result = verifyRevocationList(
      makeRevocations(a, {
        versions: [{ id: "x", version: "1.0.0" }, { id: "y" } as never],
      }),
      "official",
      roots,
    );
    expect(result.ok && result.list.versions).toEqual([
      { id: "x", version: "1.0.0", reason: undefined },
    ]);
  });
});
