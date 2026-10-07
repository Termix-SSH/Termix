import { describe, expect, it } from "vitest";
import {
  hasSettingsPage,
  hasVisibleFields,
} from "@/settings/settings-fields-util";
import type { PluginSettingsField } from "@/api/plugins-api";

const field = (hidden = false) =>
  ({ key: "a", type: "string", hidden }) as unknown as PluginSettingsField;

describe("hasVisibleFields", () => {
  it("ignores hidden fields", () => {
    expect(hasVisibleFields([field(true)])).toBe(false);
    expect(hasVisibleFields([field(true), field()])).toBe(true);
  });
});

describe("hasSettingsPage", () => {
  it("needs an enabled plugin", () => {
    expect(
      hasSettingsPage(
        { enabled: false, contributes: { settings: { user: [field()] } } },
        true,
      ),
    ).toBe(false);
  });

  it("is false with no settings or only hidden ones", () => {
    expect(hasSettingsPage({ enabled: true, contributes: null }, true)).toBe(
      false,
    );
    expect(
      hasSettingsPage(
        { enabled: true, contributes: { settings: { user: [field(true)] } } },
        true,
      ),
    ).toBe(false);
  });

  it("counts admin settings only for admins", () => {
    const plugin = {
      enabled: true,
      contributes: { settings: { admin: [field()] } },
    };
    expect(hasSettingsPage(plugin, true)).toBe(true);
    expect(hasSettingsPage(plugin, false)).toBe(false);
  });

  it("counts user settings for anyone", () => {
    expect(
      hasSettingsPage(
        { enabled: true, contributes: { settings: { user: [field()] } } },
        false,
      ),
    ).toBe(true);
  });
});
