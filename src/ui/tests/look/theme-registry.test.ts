import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_THEMES,
  arePluginThemesKnown,
  effectiveThemeId,
  getTheme,
  listThemes,
  resetPluginThemes,
  setPluginThemes,
  themeLabel,
  themeMode,
  type ThemeDef,
} from "@/look/theme-registry";

afterEach(() => resetPluginThemes());

const swatch = { background: "#000000", panel: "#111111", text: "#ffffff" };

function pluginTheme(
  id: string,
  mode: "light" | "dark" = "dark",
  pluginId = "more-themes",
): ThemeDef {
  return { id, label: `theme.${id}`, mode, swatch, pluginId };
}

describe("theme registry", () => {
  it("keeps only a light and a dark theme in core", () => {
    expect(BUILTIN_THEMES.map((theme) => theme.id)).toEqual(["light", "dark"]);
    expect(listThemes().map((theme) => theme.id)).toEqual(["light", "dark"]);
    expect(arePluginThemesKnown()).toBe(false);
  });

  it("lets a plugin theme take a built-in's place and adds new ones in the order given", () => {
    setPluginThemes([
      {
        ...pluginTheme("dark"),
        cssHref: "/plugin-assets/more-themes/_themes/dark.css",
      },
      pluginTheme("nord"),
      pluginTheme("dracula"),
      pluginTheme("paper", "light"),
    ]);
    const ids = listThemes().map((theme) => theme.id);
    expect(ids).toEqual(["light", "dark", "nord", "dracula", "paper"]);
    expect(getTheme("dark")?.pluginId).toBe("more-themes");
    expect(arePluginThemesKnown()).toBe(true);

    setPluginThemes([]);
    expect(getTheme("dark")?.pluginId).toBeUndefined();
    expect(getTheme("paper")).toBeUndefined();
    expect(listThemes().map((theme) => theme.id)).toEqual(["light", "dark"]);
  });

  it("reports each theme's mode, following the OS for system", () => {
    expect(themeMode("light")).toBe("light");
    expect(["light", "dark"]).toContain(themeMode("system"));
    setPluginThemes([pluginTheme("paper", "light"), pluginTheme("nord")]);
    expect(themeMode("paper")).toBe("light");
    expect(themeMode("nord")).toBe("dark");
  });

  it("assumes dark for an unknown theme until the plugins have loaded, then follows the OS", () => {
    expect(themeMode("nord")).toBe("dark");
    setPluginThemes([]);
    expect(["light", "dark"]).toContain(themeMode("nord"));
    expect(themeMode("nord")).toBe(themeMode("system"));
  });

  it("falls back to system for a saved theme that no longer exists", () => {
    // Plugins not read yet: the id may still arrive, so keep it.
    expect(effectiveThemeId("nord")).toBe("nord");
    setPluginThemes([pluginTheme("nord")]);
    expect(effectiveThemeId("nord")).toBe("nord");
    expect(effectiveThemeId("light")).toBe("light");
    expect(effectiveThemeId("system")).toBe("system");
    setPluginThemes([]);
    expect(effectiveThemeId("nord")).toBe("system");
    expect(effectiveThemeId("dark")).toBe("dark");
  });

  it("translates core labels in core and plugin labels in the plugin", () => {
    const t = ((key: string, options?: { defaultValue?: string }) =>
      key.includes(":")
        ? (options?.defaultValue ?? key)
        : `t(${key})`) as never;
    expect(themeLabel(BUILTIN_THEMES[0], t)).toBe(
      `t(${BUILTIN_THEMES[0].label})`,
    );
    expect(
      themeLabel(
        { id: "paper", label: "Paper", mode: "light", swatch, pluginId: "x" },
        t,
      ),
    ).toBe("Paper");
  });
});
