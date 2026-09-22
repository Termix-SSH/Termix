import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseManifest } from "@termix/plugin-sdk/manifest";
import { createMockCtx } from "@termix/plugin-sdk/testing";

/**
 * The API key and base URL are this plugin's own settings now.
 *
 * They used to live in the core `settings` table behind a core route that
 * existed only for this plugin, with the key stored in plaintext. These tests
 * pin the shape core renders the page from, and that reading a plugin's own
 * settings needs no capability.
 */
const manifest = parseManifest(
  JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, "../../manifest.json"),
      "utf8",
    ),
  ),
);

describe("tailscale settings contribution", () => {
  it("parses cleanly", () => {
    expect(manifest.errors).toEqual([]);
  });

  it("declares the API key as a secret, so it is encrypted and redacted", () => {
    const apiKey = manifest.manifest?.contributes?.settings?.admin?.find(
      (field) => field.key === "apiKey",
    );

    expect(apiKey?.type).toBe("secret");
  });

  it("declares the base URL as plain text, because it is not a secret", () => {
    const baseUrl = manifest.manifest?.contributes?.settings?.admin?.find(
      (field) => field.key === "apiBaseUrl",
    );

    expect(baseUrl?.type).toBe("string");
    expect(baseUrl?.default).toBe("");
  });

  it("puts both fields on the admin scope, not the user one", () => {
    const settings = manifest.manifest?.contributes?.settings;

    expect(settings?.admin?.map((field) => field.key)).toContain("apiKey");
    expect(settings?.user).toBeUndefined();
  });

  it("keeps settings:read-core, which it still holds for core keys", () => {
    expect(manifest.manifest?.capabilities).toContain("settings:read-core");
  });
});

describe("reading its own settings", () => {
  it("needs no capability", async () => {
    // Nothing granted at all: a plugin reading its own configuration must not
    // have to declare anything for it.
    const { ctx } = createMockCtx({
      pluginId: "tailscale",
      capabilities: [],
      settings: { apiKey: "tskey-api-test", apiBaseUrl: "" },
    });

    await expect(ctx.settings.get("apiKey")).resolves.toBe("tskey-api-test");
  });

  it("can write and read a value back", async () => {
    const { ctx } = createMockCtx({ pluginId: "tailscale", capabilities: [] });

    await ctx.settings.set("apiBaseUrl", "https://headscale.example");

    await expect(ctx.settings.get("apiBaseUrl")).resolves.toBe(
      "https://headscale.example",
    );
  });

  it("still needs settings:read-core to reach a core key", async () => {
    const { ctx } = createMockCtx({ pluginId: "tailscale", capabilities: [] });

    await expect(ctx.settings.readCore("app_name")).rejects.toThrow(
      /settings:read-core/,
    );
  });
});
