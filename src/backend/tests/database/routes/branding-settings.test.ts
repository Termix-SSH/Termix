import { describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { BRANDING_DEFAULT_APP_NAME, resolveBrandingSettings } =
  await import("../../../database/routes/branding-settings.js");

function settingSource(values: Record<string, string>) {
  return { get: async (key: string) => values[key] ?? null };
}

describe("resolveBrandingSettings", () => {
  it("returns built-in defaults when nothing is persisted", async () => {
    const settings = await resolveBrandingSettings(settingSource({}));
    expect(settings).toEqual({
      appName: BRANDING_DEFAULT_APP_NAME,
      tagline: "",
      logo: null,
    });
  });

  it("returns the persisted values when present", async () => {
    const settings = await resolveBrandingSettings(
      settingSource({
        branding_app_name: "Acme Ops",
        branding_tagline: "Reliable infrastructure",
        branding_logo: "data:image/png;base64,AAA=",
      }),
    );
    expect(settings).toEqual({
      appName: "Acme Ops",
      tagline: "Reliable infrastructure",
      logo: "data:image/png;base64,AAA=",
    });
  });
});

describe("branding provider", () => {
  it("uses a plugin's branding provider and falls back when it throws", async () => {
    const registry = await import("../../../plugins/registry.js");
    const provider = async () => ({
      appName: " Acme ",
      tagline: "Hello",
      logo: "data:image/png;base64,AAAA",
    });
    registry.provide("demo.brandingProvider", provider);
    try {
      await expect(resolveBrandingSettings(settingSource({}))).resolves.toEqual(
        {
          appName: "Acme",
          tagline: "Hello",
          logo: "data:image/png;base64,AAAA",
        },
      );

      registry.revoke("demo.brandingProvider");
      registry.provide("demo.brandingProvider", async () => {
        throw new Error("broken");
      });
      await expect(
        resolveBrandingSettings(settingSource({ branding_app_name: "Stored" })),
      ).resolves.toMatchObject({ appName: "Stored" });
    } finally {
      registry.clearRegistry();
    }
  });
});
