import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_THEMES,
  arePluginThemesKnown,
  getTheme,
  listThemes,
  resetPluginThemes,
  setPluginThemes,
  themeLabel,
  themeMode,
} from "@/look/theme-registry";

afterEach(() => resetPluginThemes());

const swatch = { background: "#000000", panel: "#111111", text: "#ffffff" };

describe("theme registry", () => {
  it("lists the built-ins in their order", () => {
    expect(listThemes().map((theme) => theme.id)).toEqual(
      BUILTIN_THEMES.map((theme) => theme.id),
    );
    expect(arePluginThemesKnown()).toBe(false);
  });

  it("lets a plugin theme take a built-in's place and adds new ones after", () => {
    setPluginThemes([
      {
        id: "nord",
        label: "themes.nord",
        mode: "dark",
        swatch,
        pluginId: "more-themes",
        cssHref: "/plugin-assets/more-themes/_themes/nord.css",
      },
      {
        id: "paper",
        label: "Paper",
        mode: "light",
        swatch,
        pluginId: "more-themes",
      },
    ]);
    const ids = listThemes().map((theme) => theme.id);
    expect(ids.indexOf("nord")).toBe(
      BUILTIN_THEMES.findIndex((theme) => theme.id === "nord"),
    );
    expect(ids[ids.length - 1]).toBe("paper");
    expect(getTheme("nord")?.pluginId).toBe("more-themes");
    expect(arePluginThemesKnown()).toBe(true);

    setPluginThemes([]);
    expect(getTheme("nord")?.pluginId).toBeUndefined();
    expect(getTheme("paper")).toBeUndefined();
  });

  it("reports each theme's mode, following the OS for system", () => {
    expect(themeMode("light")).toBe("light");
    expect(themeMode("dracula")).toBe("dark");
    expect(["light", "dark"]).toContain(themeMode("system"));
    setPluginThemes([
      { id: "paper", label: "Paper", mode: "light", swatch, pluginId: "x" },
    ]);
    expect(themeMode("paper")).toBe("light");
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
