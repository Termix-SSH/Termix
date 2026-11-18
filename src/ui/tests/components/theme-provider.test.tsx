import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { resetPluginThemes, setPluginThemes } from "@/look/theme-registry";

let api: ReturnType<typeof useTheme> | null = null;
function Capture() {
  api = useTheme();
  return null;
}

function mount() {
  return render(
    <ThemeProvider defaultTheme="dark" storageKey="test-theme">
      <Capture />
    </ThemeProvider>,
  );
}

const classes = () => [...document.documentElement.classList];
const loadSheets = () =>
  act(() => {
    for (const link of document.head.querySelectorAll("link")) {
      link.dispatchEvent(new Event("load"));
    }
  });

afterEach(() => {
  cleanup();
  resetPluginThemes();
  localStorage.clear();
  document.documentElement.className = "";
  document.getElementById("termix-theme-css")?.remove();
});

describe("ThemeProvider", () => {
  it("puts exactly one theme class on <html> and keeps the choice", () => {
    mount();
    expect(classes()).toEqual(["dark"]);
    act(() => api!.setTheme("nord"));
    expect(classes()).toEqual(["nord"]);
    expect(localStorage.getItem("test-theme")).toBe("nord");
  });

  it("can show a theme without keeping it", () => {
    mount();
    act(() => api!.setTheme("gruvbox", false));
    expect(classes()).toEqual(["gruvbox"]);
    expect(localStorage.getItem("test-theme")).toBeNull();
  });

  it("previews a theme and goes back", () => {
    mount();
    act(() => api!.setThemePreview("light"));
    expect(classes()).toEqual(["light"]);
    expect(api!.theme).toBe("dark");
    act(() => api!.setThemePreview(null));
    expect(classes()).toEqual(["dark"]);
  });

  it("applies a plugin theme's class and stylesheet, and drops them after", () => {
    mount();
    act(() =>
      setPluginThemes([
        {
          id: "paper",
          label: "Paper",
          mode: "light",
          swatch: { background: "#fff", panel: "#eee", text: "#111" },
          pluginId: "paper-themes",
          cssHref: "/plugin-assets/paper-themes/_themes/paper.css?v=1",
        },
      ]),
    );
    act(() => api!.setTheme("paper"));
    // The old theme stays until the new stylesheet is in.
    expect(classes()).toEqual(["dark"]);
    loadSheets();
    expect(classes()).toEqual(["paper"]);
    expect(
      (document.getElementById("termix-theme-css") as HTMLLinkElement).href,
    ).toContain("paper.css");
    act(() => api!.setTheme("dark"));
    expect(classes()).toEqual(["dark"]);
    expect(document.getElementById("termix-theme-css")).toBeNull();
  });

  it("shows system when the saved theme's plugin is gone", () => {
    localStorage.setItem("test-theme", "nord");
    mount();
    // Plugins not read yet, so the saved theme is kept.
    expect(classes()).toEqual(["nord"]);
    act(() => setPluginThemes([]));
    expect(api!.theme).toBe("system");
    expect(classes()).toHaveLength(1);
    expect(["light", "dark"]).toContain(classes()[0]);
    expect(localStorage.getItem("test-theme")).toBe("nord");
  });

  it("brings the saved theme back when its plugin returns", () => {
    localStorage.setItem("test-theme", "nord");
    mount();
    act(() => setPluginThemes([]));
    act(() =>
      setPluginThemes([
        {
          id: "nord",
          label: "theme.nord",
          mode: "dark",
          swatch: { background: "#2e3440", panel: "#3b4252", text: "#eceff4" },
          pluginId: "classic-themes",
          cssHref: "/plugin-assets/classic-themes/_themes/nord.css?v=1",
        },
      ]),
    );
    expect(api!.theme).toBe("nord");
    loadSheets();
    expect(classes()).toEqual(["nord"]);
  });

  it("never shows a half loaded theme while hovering previews", () => {
    mount();
    const sheet = (id: string) => ({
      id,
      label: id,
      mode: "dark" as const,
      swatch: { background: "#000", panel: "#111", text: "#fff" },
      pluginId: "classic-themes",
      cssHref: `/plugin-assets/classic-themes/_themes/${id}.css?v=1`,
    });
    act(() => setPluginThemes([sheet("nord"), sheet("dracula")]));
    act(() => api!.setThemePreview("nord"));
    act(() => api!.setThemePreview("dracula"));
    expect(classes()).toEqual(["dark"]);
    act(() => api!.setThemePreview(null));
    expect(classes()).toEqual(["dark"]);
    // A late load from a preview that already ended changes nothing.
    loadSheets();
    expect(classes()).toEqual(["dark"]);
    expect(document.head.querySelectorAll("link")).toHaveLength(0);
  });
});
