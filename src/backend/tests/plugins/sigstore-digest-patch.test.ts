import crypto from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  patchSigstoreCore,
} = require("../../../../scripts/patch-sigstore-verify.cjs");

const original = `"use strict";
const crypto_1 = { default: require("node:crypto") };
function verify(data, key, signature, algorithm) {
    // The try/catch is to work around an issue in Node 14.x where verify throws
    // an error in some scenarios if the signature is invalid.
    try {
        return crypto_1.default.verify(algorithm, data, key, signature);
    }
    catch (e) {
        return false;
    }
}
module.exports = { verify };`;

function load(source: string) {
  const module = { exports: {} as Record<string, unknown> };
  new Function("module", "require", source)(module, require);
  return module.exports as {
    verify: (
      data: Buffer,
      key: crypto.KeyObject,
      signature: Buffer,
      algorithm?: string,
    ) => boolean;
  };
}

describe("sigstore default digest patch", () => {
  const patched = patchSigstoreCore(original);

  it("applies once and leaves a patched file alone", () => {
    expect(patched).toContain("defaultDigest(key)");
    expect(patchSigstoreCore(patched)).toBe(patched);
    expect(() => patchSigstoreCore("something else")).toThrow(/changed/);
  });

  it.each([
    ["prime256v1", "sha256"],
    ["secp384r1", "sha384"],
  ])("checks an ECDSA %s signature with no hash named", (curve, hash) => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: curve,
    });
    const data = Buffer.from("rekor entry");
    const signature = crypto.sign(hash, data, privateKey);
    const { verify } = load(patched);
    expect(verify(data, publicKey, signature)).toBe(true);
    expect(verify(Buffer.from("other"), publicKey, signature)).toBe(false);
  });

  it("still checks ed25519, which takes no hash", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const data = Buffer.from("checkpoint");
    const signature = crypto.sign(null, data, privateKey);
    expect(load(patched).verify(data, publicKey, signature)).toBe(true);
  });

  it("matches the installed @sigstore/core", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const verifyDir = path.dirname(
      require.resolve("@sigstore/verify/package.json"),
    );
    const target = require.resolve("@sigstore/core/dist/crypto.js", {
      paths: [verifyDir],
    });
    expect(fs.readFileSync(target, "utf8")).toContain("defaultDigest(key)");
  });
});
