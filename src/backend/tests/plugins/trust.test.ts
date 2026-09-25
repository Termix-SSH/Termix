import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  requireSignedPlugins,
  verifyPluginArtifact,
  type TrustedPluginKey,
} from "../../plugins/trust.js";

function keyPair(): { key: TrustedPluginKey; privateKey: crypto.KeyObject } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("base64");
  return { key: { id: "test", publicKey: raw, addedIn: "2.9.0" }, privateKey };
}

function signed(buffer: Buffer, privateKey: crypto.KeyObject) {
  const digest = crypto.createHash("sha256").update(buffer).digest();
  return {
    sha256: digest.toString("hex"),
    signature: crypto.sign(null, digest, privateKey).toString("base64"),
  };
}

describe("verifyPluginArtifact", () => {
  const artifact = Buffer.from("a plugin archive");

  it("accepts a file signed by a pinned key", () => {
    const { key, privateKey } = keyPair();
    const { sha256, signature } = signed(artifact, privateKey);
    expect(verifyPluginArtifact(artifact, sha256, signature, [key])).toEqual({
      ok: true,
      keyId: "test",
    });
  });

  it("accepts a signature from any of several pinned keys", () => {
    const old = keyPair();
    const current = keyPair();
    const { sha256, signature } = signed(artifact, old.privateKey);
    const result = verifyPluginArtifact(artifact, sha256, signature, [
      current.key,
      { ...old.key, id: "old" },
    ]);
    expect(result).toEqual({ ok: true, keyId: "old" });
  });

  it("refuses a tampered file", () => {
    const { key, privateKey } = keyPair();
    const { sha256, signature } = signed(artifact, privateKey);
    const tampered = Buffer.from("a plugin archivE");
    expect(verifyPluginArtifact(tampered, sha256, signature, [key])).toEqual({
      ok: false,
      reason: "sha256 does not match the file",
    });
  });

  it("refuses a tampered file even when the sha256 matches it", () => {
    const { key, privateKey } = keyPair();
    const { signature } = signed(artifact, privateKey);
    const tampered = Buffer.from("something else");
    const sha256 = crypto.createHash("sha256").update(tampered).digest("hex");
    expect(verifyPluginArtifact(tampered, sha256, signature, [key])).toEqual({
      ok: false,
      reason: "signature does not match a trusted key",
    });
  });

  it("refuses a signature from a key that is not pinned", () => {
    const pinned = keyPair();
    const other = keyPair();
    const { sha256, signature } = signed(artifact, other.privateKey);
    expect(
      verifyPluginArtifact(artifact, sha256, signature, [pinned.key]).ok,
    ).toBe(false);
  });

  it("refuses garbage and an empty key list", () => {
    const { key, privateKey } = keyPair();
    const { sha256, signature } = signed(artifact, privateKey);
    expect(verifyPluginArtifact(artifact, sha256, "bm9wZQ==", [key]).ok).toBe(
      false,
    );
    expect(verifyPluginArtifact(artifact, "zz", signature, [key]).ok).toBe(
      false,
    );
    expect(verifyPluginArtifact(artifact, sha256, signature, []).ok).toBe(
      false,
    );
  });

  it("trusts no key by default until one is pinned", () => {
    const { privateKey } = keyPair();
    const { sha256, signature } = signed(artifact, privateKey);
    expect(verifyPluginArtifact(artifact, sha256, signature).ok).toBe(false);
  });
});

describe("requireSignedPlugins", () => {
  it("is on only for the exact value true", () => {
    const before = process.env.TERMIX_REQUIRE_SIGNED_PLUGINS;
    process.env.TERMIX_REQUIRE_SIGNED_PLUGINS = "true";
    expect(requireSignedPlugins()).toBe(true);
    process.env.TERMIX_REQUIRE_SIGNED_PLUGINS = "1";
    expect(requireSignedPlugins()).toBe(false);
    if (before === undefined) delete process.env.TERMIX_REQUIRE_SIGNED_PLUGINS;
    else process.env.TERMIX_REQUIRE_SIGNED_PLUGINS = before;
  });
});
