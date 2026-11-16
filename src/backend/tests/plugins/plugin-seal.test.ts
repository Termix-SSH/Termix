import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const keys = vi.hoisted(() => ({
  current: Buffer.alloc(32, 1),
  previous: [] as Buffer[],
}));
vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getEncryptionKey: async () => keys.current,
      getPreviousKeys: async () => keys.previous,
    }),
  },
}));

const { PLUGIN_SEALED, resealPluginValue, sealForPlugin, unsealForPlugin } =
  await import("../../plugins/plugin-seal.js");

beforeEach(() => {
  keys.current = Buffer.alloc(32, 1);
  keys.previous = [];
});

describe("plugin seal", () => {
  it("opens only for the plugin that sealed it", async () => {
    const sealed = await sealForPlugin("vault", "token");
    expect(sealed.startsWith("psenc:v1:vault:")).toBe(true);
    expect(await unsealForPlugin("vault", sealed)).toBe("token");
    expect(await unsealForPlugin("vaults", sealed)).toBeNull();
    expect(
      await unsealForPlugin("other", sealed.replace(":vault:", ":other:")),
    ).toBeNull();
  });

  it("refuses text that was never sealed this way", async () => {
    for (const value of [
      "token",
      "sysenc:v1:aaaa:bbbb:cccc",
      "psenc:v1:vault:short",
      "psenc:v1:BAD ID:a:b:c",
      null,
      42,
    ]) {
      expect(await unsealForPlugin("vault", value)).toBeNull();
    }
  });

  it("refuses a value someone changed", async () => {
    const sealed = await sealForPlugin("vault", "token");
    const parts = sealed.split(":");
    const data = Buffer.from(parts[5], "base64");
    data[0] ^= 1;
    parts[5] = data.toString("base64");
    expect(await unsealForPlugin("vault", parts.join(":"))).toBeNull();
  });

  it("is found inside JSON by the scanners", async () => {
    const sealed = await sealForPlugin("my-plugin", "x");
    const json = JSON.stringify({ secret: sealed, other: 1 });
    expect(json.match(PLUGIN_SEALED)).toEqual([sealed]);
  });

  it("still opens after a key rotation and reseals to the new key", async () => {
    const sealed = await sealForPlugin("vault", "token");
    keys.previous = [keys.current];
    keys.current = crypto.randomBytes(32);
    expect(await unsealForPlugin("vault", sealed)).toBe("token");
    const moved = await resealPluginValue(sealed);
    expect(moved).not.toBeNull();
    keys.previous = [];
    expect(await unsealForPlugin("vault", moved!)).toBe("token");
    // Already on the current key: nothing to do.
    expect(await resealPluginValue(moved!)).toBeNull();
  });

  it("says when no key opens a value", async () => {
    const sealed = await sealForPlugin("vault", "token");
    keys.current = crypto.randomBytes(32);
    await expect(resealPluginValue(sealed)).rejects.toThrow(/No known key/);
  });
});
