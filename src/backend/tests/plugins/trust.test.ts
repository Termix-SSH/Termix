import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  COMMUNITY_PLUGIN_KEYS,
  TRUSTED_PLUGIN_KEYS,
  isPluginPublicKey,
  legacyAllowed,
  pluginKeyId,
  requireSignedPlugins,
  setCustomPluginKeys,
  setTrustRootsForTests,
  verifyAnyTrusted,
  verifyPluginArtifact,
  type TrustedPluginKey,
} from "../../plugins/trust.js";
import { LEGACY_TRUST_UNTIL, ROOT_KEYS } from "../../plugins/trust-chain.js";
import {
  clearRevocationLists,
  setRevocationList,
} from "../../plugins/revocation-state.js";
import {
  envelopeFor,
  makeCert,
  makeOnlineKey,
  makeRoot,
  rootsFor,
} from "../fixtures/trust-chain.js";

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

describe("chain signatures", () => {
  const artifact = Buffer.from("a plugin archive");
  const sha256 = crypto.createHash("sha256").update(artifact).digest("hex");
  const official = makeRoot();
  const community = makeRoot();
  const online = makeOnlineKey();

  beforeEach(() => {
    setTrustRootsForTests(rootsFor([official], [community]));
    clearRevocationLists();
  });
  afterEach(() => {
    setTrustRootsForTests(null);
    clearRevocationLists();
  });

  const sig = (cert = makeCert(official, online)) =>
    JSON.stringify(envelopeFor(artifact, online, cert));

  it("accepts an envelope and reports its tier and root", () => {
    expect(verifyAnyTrusted(artifact, sha256, sig())).toEqual({
      ok: true,
      keyId: online.keyId,
      tier: "official",
      rootId: official.key.id,
    });
    const cert = makeCert(community, online, { tier: "community" });
    expect(verifyAnyTrusted(artifact, sha256, sig(cert))).toMatchObject({
      ok: true,
      tier: "community",
    });
  });

  it("refuses an envelope that claims official but a community root signed", () => {
    expect(
      verifyAnyTrusted(artifact, sha256, sig(makeCert(community, online))).ok,
    ).toBe(false);
  });

  it("keeps an installed plugin whose certificate expired, but not a download", () => {
    const cert = makeCert(official, online, {
      expires: "2026-01-02T00:00:00Z",
    });
    expect(verifyAnyTrusted(artifact, sha256, sig(cert)).ok).toBe(true);
    expect(
      verifyAnyTrusted(artifact, sha256, sig(cert), { mode: "download" }),
    ).toEqual({ ok: false, reason: "certificate has expired" });
  });

  it("refuses an envelope over another file", () => {
    expect(verifyAnyTrusted(artifact, "0".repeat(64), sig())).toEqual({
      ok: false,
      reason: "sha256 does not match the file",
    });
  });

  it("lets the official list revoke any key, and the community list only community ones", () => {
    const list = (tier: "official" | "community") => ({
      type: "termix-revocations" as const,
      tier,
      version: 1,
      issued: "",
      keys: [{ keyId: online.keyId }],
      plugins: [],
      versions: [],
    });
    setRevocationList("community", list("community"));
    expect(verifyAnyTrusted(artifact, sha256, sig()).ok).toBe(true);
    const cert = makeCert(community, online, { tier: "community" });
    expect(verifyAnyTrusted(artifact, sha256, sig(cert)).ok).toBe(false);

    setRevocationList("official", list("official"));
    expect(verifyAnyTrusted(artifact, sha256, sig()).ok).toBe(false);
  });
});

describe("legacyAllowed", () => {
  const artifact = Buffer.from("a plugin archive");
  afterEach(() => setTrustRootsForTests(null));

  it("keeps pre-chain keys for installed plugins until the cutoff only", () => {
    const before = LEGACY_TRUST_UNTIL - 1;
    expect(legacyAllowed("official", { mode: "installed", now: before })).toBe(
      true,
    );
    expect(
      legacyAllowed("official", { mode: "installed", now: LEGACY_TRUST_UNTIL }),
    ).toBe(false);
    expect(
      legacyAllowed("community", {
        mode: "installed",
        now: LEGACY_TRUST_UNTIL,
      }),
    ).toBe(false);
  });

  it("never takes pre-chain keys for a download once the tier has roots", () => {
    expect(legacyAllowed("official", { mode: "download", now: 0 })).toBe(false);
    setTrustRootsForTests({ official: [], community: ROOT_KEYS.community });
    expect(legacyAllowed("official", { mode: "download" })).toBe(true);
    expect(legacyAllowed("community", { mode: "download" })).toBe(false);
  });

  it("leaves custom registry keys alone after the cutoff", () => {
    const { key, privateKey } = keyPair();
    setCustomPluginKeys([key]);
    const { sha256, signature } = signed(artifact, privateKey);
    expect(
      verifyAnyTrusted(artifact, sha256, signature, {
        mode: "download",
        now: LEGACY_TRUST_UNTIL + 1,
      }),
    ).toMatchObject({ ok: true, tier: "custom" });
    setCustomPluginKeys([]);
  });
});
