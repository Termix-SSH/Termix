import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  plugins: [] as Array<{ id: string; registryId: string | null }>,
  indexes: new Map<string, unknown>(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings.get(key) ?? null,
    set: async (key: string, value: string) =>
      void state.settings.set(key, value),
  }),
  createCurrentPluginRepository: () => ({
    listAll: async () => state.plugins,
  }),
}));

vi.mock("../../plugins/registry-index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../plugins/registry-index.js")>();
  return {
    ...actual,
    fetchIndexAt: async (url: string) => {
      const raw = state.indexes.get(url);
      if (!raw) throw new Error("answered 404");
      return actual.parseRegistryIndex(raw);
    },
  };
});

const registries = await import("../../plugins/registries.js");
const { getCustomPluginKeys, pluginKeyId } =
  await import("../../plugins/trust.js");

function newKey(): string {
  return crypto
    .generateKeyPairSync("ed25519")
    .publicKey.export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("base64");
}

const URL_A = "https://example.com/a/index.json";

function serve(url: string, index: Record<string, unknown>): void {
  state.indexes.set(url, { plugins: [], ...index });
}

beforeEach(async () => {
  state.settings.clear();
  state.plugins = [];
  state.indexes.clear();
  await registries.loadCustomRegistryKeys();
});

describe("registry sources", () => {
  it("is official only by default", async () => {
    const sources = await registries.listSources();
    expect(sources.map((source) => source.id)).toEqual(["official"]);
  });

  it("adds community when it is turned on", async () => {
    await registries.setRegistryEnabled("community", true);
    const sources = await registries.listSources();
    expect(sources.map((source) => [source.id, source.tier])).toEqual([
      ["official", "official"],
      ["community", "community"],
    ]);
    await registries.setRegistryEnabled("community", false);
    expect((await registries.listSources()).map((s) => s.id)).toEqual([
      "official",
    ]);
  });

  it("never turns the official registry off", async () => {
    await expect(
      registries.setRegistryEnabled("official", false),
    ).rejects.toMatchObject({ code: "OFFICIAL" });
  });

  it("reads a broken stored value as official only", () => {
    expect(registries.parseRegistriesConfig("{nope")).toEqual({
      community: { enabled: false },
      custom: [],
    });
  });
});

describe("adding a custom registry", () => {
  it("previews the name, plugin count and key, then pins that key", async () => {
    const key = newKey();
    serve(URL_A, {
      registry: "acme",
      name: "Acme Plugins",
      publicKey: key,
      plugins: [
        {
          id: "tool",
          versions: [
            {
              version: "1.0.0",
              api: "1",
              url: "https://example.com/tool.tmxplug",
              sha256: "a".repeat(64),
              signature: "sig",
            },
          ],
        },
      ],
    });
    const preview = await registries.previewRegistry(URL_A);
    expect(preview).toEqual({
      id: "acme",
      name: "Acme Plugins",
      url: URL_A,
      keyId: pluginKeyId(key),
      plugins: 1,
    });

    const added = await registries.addRegistry(URL_A, preview.keyId);
    expect(added).toMatchObject({ id: "acme", enabled: true, publicKey: key });
    expect(getCustomPluginKeys().map((k) => k.publicKey)).toEqual([key]);
    const sources = await registries.listSources();
    expect(sources.at(-1)).toMatchObject({
      id: "acme",
      tier: "custom",
      url: URL_A,
    });
    expect(sources.at(-1)?.keys.map((k) => k.publicKey)).toEqual([key]);
  });

  it("refuses when the key changed after the preview", async () => {
    serve(URL_A, { registry: "acme", publicKey: newKey() });
    const preview = await registries.previewRegistry(URL_A);
    serve(URL_A, { registry: "acme", publicKey: newKey() });
    await expect(
      registries.addRegistry(URL_A, preview.keyId),
    ).rejects.toMatchObject({ code: "KEY_MISMATCH" });
    expect((await registries.readRegistriesConfig()).custom).toEqual([]);
  });

  it("refuses an index without a key", async () => {
    serve(URL_A, { registry: "acme" });
    await expect(registries.previewRegistry(URL_A)).rejects.toMatchObject({
      code: "NO_PUBLIC_KEY",
    });
  });

  it("refuses plain http and junk", async () => {
    await expect(
      registries.previewRegistry("http://example.com/index.json"),
    ).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(registries.previewRegistry("nope")).rejects.toMatchObject({
      code: "INVALID_URL",
    });
    await expect(registries.previewRegistry(42)).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });

  it("refuses an index it cannot read", async () => {
    await expect(registries.previewRegistry(URL_A)).rejects.toMatchObject({
      code: "REGISTRY_UNREACHABLE",
    });
  });

  it("refuses the same URL twice and the built in ones", async () => {
    const key = newKey();
    serve(URL_A, { registry: "acme", publicKey: key });
    await registries.addRegistry(URL_A, pluginKeyId(key));
    await expect(registries.previewRegistry(URL_A)).rejects.toMatchObject({
      code: "ALREADY_ADDED",
    });
    await expect(
      registries.previewRegistry(
        "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/community/index.json",
      ),
    ).rejects.toMatchObject({ code: "ALREADY_ADDED" });
  });

  it("never takes a reserved or used id", async () => {
    const urlB = "https://example.com/b/index.json";
    const urlC = "https://example.com/c/index.json";
    const keyA = newKey();
    const keyB = newKey();
    const keyC = newKey();
    serve(URL_A, { registry: "official", publicKey: keyA });
    serve(urlB, { registry: "community", publicKey: keyB });
    serve(urlC, { registry: "Official", publicKey: keyC });
    expect((await registries.addRegistry(URL_A, pluginKeyId(keyA))).id).toBe(
      "official-2",
    );
    expect((await registries.addRegistry(urlB, pluginKeyId(keyB))).id).toBe(
      "community-2",
    );
    expect((await registries.addRegistry(urlC, pluginKeyId(keyC))).id).toBe(
      "official-3",
    );
  });
});

describe("turning off and removing a custom registry", () => {
  async function addAcme(): Promise<string> {
    const key = newKey();
    serve(URL_A, { registry: "acme", publicKey: key });
    await registries.addRegistry(URL_A, pluginKeyId(key));
    return key;
  }

  it("keeps trusting the key of a registry that is off", async () => {
    const key = await addAcme();
    await registries.setRegistryEnabled("acme", false);
    expect((await registries.listSources()).map((s) => s.id)).toEqual([
      "official",
    ]);
    expect(await registries.findSource("acme")).toBeNull();
    expect(getCustomPluginKeys().map((k) => k.publicKey)).toEqual([key]);
  });

  it("refuses to remove a registry with installed plugins", async () => {
    await addAcme();
    state.plugins = [{ id: "tool", registryId: "acme" }];
    await expect(registries.removeRegistry("acme")).rejects.toMatchObject({
      code: "REGISTRY_IN_USE",
      details: { plugins: ["tool"] },
    });
  });

  it("removes it and stops trusting its key", async () => {
    await addAcme();
    await registries.removeRegistry("acme");
    expect((await registries.readRegistriesConfig()).custom).toEqual([]);
    expect(getCustomPluginKeys()).toEqual([]);
  });

  it("only turns built in registries off", async () => {
    await expect(registries.removeRegistry("community")).rejects.toMatchObject({
      code: "BUILT_IN",
    });
    await expect(registries.removeRegistry("nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("keys from a linked server", () => {
  it("trusts them next to the local ones and survives a reload", async () => {
    const key = newKey();
    await registries.setSyncedRegistryKeys([key, "junk", 42]);
    expect(getCustomPluginKeys().map((k) => k.publicKey)).toEqual([key]);
    await registries.loadCustomRegistryKeys();
    expect(getCustomPluginKeys().map((k) => k.publicKey)).toEqual([key]);
    await registries.setSyncedRegistryKeys([]);
    expect(getCustomPluginKeys()).toEqual([]);
  });
});
