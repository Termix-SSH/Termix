import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "module";
import crypto from "node:crypto";
import {
  makeCert,
  makeOnlineKey,
  makeRoot,
} from "../src/backend/tests/fixtures/trust-chain.js";

const require = createRequire(import.meta.url);
const { signSums, loadPrivateKey } = require("./sign-sums.cjs");
const trustChain = require("../electron/trust-chain.cjs");

const sums = Buffer.from(`${"a".repeat(64)}  termix.dmg\n`);
const realRoots = trustChain.ROOT_KEYS;

afterEach(() => {
  trustChain.ROOT_KEYS.official = realRoots.official;
});

// signSums checks the certificate against the built in roots, so the test
// root stands in for them.
function useRoot() {
  const root = makeRoot();
  trustChain.ROOT_KEYS.official = [root.key];
  return root;
}

describe("sign-sums", () => {
  it("signs the sums' sha256 and wraps the matching release certificate", () => {
    const root = useRoot();
    const key = makeOnlineKey();
    const cert = makeCert(root, key, { role: "releases" });
    const envelope = signSums(sums, key.privateKey, [
      makeCert(root, makeOnlineKey(), { role: "releases" }),
      cert,
    ]);
    expect(envelope.keyId).toBe(key.keyId);
    expect(envelope.cert).toBe(cert);
    const result = trustChain.verifyEnvelopeFor(sums, envelope, {
      tier: "official",
      role: "releases",
      checkDates: true,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses to sign without a release certificate for this key", () => {
    const root = useRoot();
    const key = makeOnlineKey();
    expect(() =>
      signSums(sums, key.privateKey, [
        makeCert(root, key, { role: "plugins" }),
      ]),
    ).toThrow(/no release certificate/);
  });

  it("refuses to sign with an expired certificate", () => {
    const root = useRoot();
    const key = makeOnlineKey();
    const cert = makeCert(root, key, {
      role: "releases",
      expires: "2026-01-02T00:00:00Z",
    });
    expect(() => signSums(sums, key.privateKey, [cert])).toThrow(/expired/);
  });

  it("reads the key the way the secret stores it", () => {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const der = privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64");
    expect(loadPrivateKey(der).asymmetricKeyType).toBe("ed25519");
    expect(() => loadPrivateKey("")).toThrow(/not set/);
    const rsa = crypto.generateKeyPairSync("rsa", {
      modulusLength: 1024,
    }).privateKey;
    expect(() =>
      loadPrivateKey(
        rsa.export({ format: "der", type: "pkcs8" }).toString("base64"),
      ),
    ).toThrow(/Ed25519/);
  });
});
