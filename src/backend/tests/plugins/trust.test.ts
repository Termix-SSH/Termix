import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  COMMUNITY_PLUGIN_KEYS,
  TRUSTED_PLUGIN_KEYS,
  isPluginPublicKey,
  pluginKeyId,
  requireSignedPlugins,
  setCustomPluginKeys,
  verifyAnyTrusted,
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

describe("key tiers", () => {
  const artifact = Buffer.from("a plugin archive");

  it("derives key ids the same way the built in keys were made", () => {
    for (const key of [...TRUSTED_PLUGIN_KEYS, ...COMMUNITY_PLUGIN_KEYS]) {
      expect(pluginKeyId(key.publicKey)).toBe(key.id);
      expect(isPluginPublicKey(key.publicKey)).toBe(true);
    }
    expect(isPluginPublicKey("bm9wZQ==")).toBe(false);
    expect(isPluginPublicKey(42)).toBe(false);
  });

  it("keeps the community key apart from the official ones", () => {
    const official = new Set(TRUSTED_PLUGIN_KEYS.map((key) => key.id));
    for (const key of COMMUNITY_PLUGIN_KEYS) {
      expect(official.has(key.id)).toBe(false);
    }
  });

  it("verifies a custom key only while it is set, as the custom tier", () => {
    const { key, privateKey } = keyPair();
    const { sha256, signature } = signed(artifact, privateKey);
    expect(verifyAnyTrusted(artifact, sha256, signature).ok).toBe(false);

    setCustomPluginKeys([key]);
    expect(verifyAnyTrusted(artifact, sha256, signature)).toEqual({
      ok: true,
      keyId: "test",
      tier: "custom",
    });

    setCustomPluginKeys([]);
    expect(verifyAnyTrusted(artifact, sha256, signature).ok).toBe(false);
  });

  it("drops a custom key that is not a valid public key", () => {
    setCustomPluginKeys([{ id: "bad", publicKey: "bm9wZQ==", addedIn: "x" }]);
    const { privateKey } = keyPair();
    const { sha256, signature } = signed(artifact, privateKey);
    expect(verifyAnyTrusted(artifact, sha256, signature).ok).toBe(false);
    setCustomPluginKeys([]);
  });

  it("stops at a sha256 mismatch", () => {
    const { key, privateKey } = keyPair();
    setCustomPluginKeys([key]);
    const { signature } = signed(artifact, privateKey);
    expect(verifyAnyTrusted(artifact, "0".repeat(64), signature)).toEqual({
      ok: false,
      reason: "sha256 does not match the file",
    });
    setCustomPluginKeys([]);
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
