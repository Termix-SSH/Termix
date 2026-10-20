import { afterEach, describe, expect, it } from "vitest";
import { applyThemeCss } from "@/look/theme-css";
import {
  getTheme,
  resetPluginThemes,
  setPluginThemes,
} from "@/look/theme-registry";

const swatch = { background: "#000000", panel: "#111111", text: "#ffffff" };
const link = () =>
  document.getElementById("termix-theme-css") as HTMLLinkElement | null;

afterEach(() => {
  resetPluginThemes();
  link()?.remove();
  localStorage.clear();
});

describe("applyThemeCss", () => {
  it("loads only the shown plugin theme's stylesheet", () => {
    setPluginThemes([
      {
        id: "paper",
        label: "Paper",
        mode: "light",
        swatch,
        pluginId: "x",
        cssHref: "/plugin-assets/x/_themes/paper.css?v=1",
      },
    ]);
    applyThemeCss("paper", getTheme("paper"));
    expect(link()?.href).toContain("/plugin-assets/x/_themes/paper.css?v=1");

    applyThemeCss("dark", getTheme("dark"));
    expect(link()).toBeNull();
  });

  it("keeps the last plugin theme's stylesheet until plugins are known", () => {
    setPluginThemes([
      {
        id: "paper",
        label: "Paper",
        mode: "light",
        swatch,
        pluginId: "x",
        cssHref: "/plugin-assets/x/_themes/paper.css?v=1",
      },
    ]);
    applyThemeCss("paper", getTheme("paper"));
    link()?.remove();

    // A reload: no plugin themes yet.
    resetPluginThemes();
    applyThemeCss("paper", getTheme("paper"));
    expect(link()?.href).toContain("paper.css");

    // Plugins answered and the theme is gone.
    setPluginThemes([]);
    applyThemeCss("paper", getTheme("paper"));
    expect(link()).toBeNull();
    expect(localStorage.getItem("termix-theme-css")).toBeNull();
  });
});
