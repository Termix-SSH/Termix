import { TERMINAL_THEMES } from "@/lib/terminal-themes.ts";

// Background/foreground per UI theme for "Termix Default" - must match index.css
const TERMIX_DEFAULT_COLORS: Record<
  string,
  { background: string; foreground: string }
> = {
  dark: { background: "#0c0d0b", foreground: "#fafafa" },
  light: { background: "#ffffff", foreground: "#111210" },
  dracula: { background: "#282a36", foreground: "#f8f8f2" },
  catppuccin: { background: "#1e1e2e", foreground: "#cdd6f4" },
  nord: { background: "#2e3440", foreground: "#eceff4" },
  solarized: { background: "#002b36", foreground: "#839496" },
  "tokyo-night": { background: "#1a1b26", foreground: "#a9b1d6" },
  "one-dark": { background: "#282c34", foreground: "#abb2bf" },
  gruvbox: { background: "#282828", foreground: "#ebdbb2" },
};

export function resolveTermixThemeColors(
  activeTheme: string,
  appTheme: string,
) {
  if (activeTheme !== "termix") {
    return (
      TERMINAL_THEMES[activeTheme]?.colors || TERMINAL_THEMES.termixDark.colors
    );
  }
  let resolvedUiTheme = appTheme;
  if (appTheme === "system") {
    resolvedUiTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  const uiColors =
    TERMIX_DEFAULT_COLORS[resolvedUiTheme] ?? TERMIX_DEFAULT_COLORS.dark;
  const base = TERMINAL_THEMES.termixDark.colors;
  return {
    ...base,
    background: uiColors.background,
    foreground: uiColors.foreground,
    cursor: uiColors.foreground,
    cursorAccent: uiColors.background,
  };
}
