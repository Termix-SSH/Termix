import type { PluginHostRecord } from "@termix/plugin-sdk/frontend";
import {
  TERMINAL_THEMES,
  resolveTerminalFontFamily,
  type TerminalTheme,
} from "./terminal-themes";
import { resolveTermixThemeColors } from "./terminal-theme";
import { ensureTerminalFontsLoaded } from "./terminal-global-styles";
import { resolveForHost } from "../terminal-settings";
import type {
  CursorStyle,
  TerminalThemeColors,
} from "../../shared/terminal-settings";

/**
 * What `terminal.resolveTheme` answers: an xterm theme and the font options
 * a terminal-like surface (a docker console, a serial console) should use to
 * look like the SSH terminal on the same host.
 */
export interface ResolvedTerminalLook {
  themeId: string;
  colors: TerminalThemeColors;
  /** A CSS font stack, ready for xterm's fontFamily option. */
  fontFamily: string;
  fontSize: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  letterSpacing: number;
  lineHeight: number;
  scrollback: number;
  minimumContrastRatio: number;
  backgroundImage: string;
  backgroundImageOpacity: number;
}

export interface ResolveLookRequest {
  /** A host record from the shell; its terminal settings decide the look. */
  host?: PluginHostRecord | null;
  /** Force a theme id instead of the host's. */
  theme?: string;
  /** The app theme ("dark", "light", "system" or a named theme). */
  appTheme?: string;
}

export function resolveTerminalLook(
  request: ResolveLookRequest,
): ResolvedTerminalLook {
  const config = resolveForHost(request.host ?? null);
  const themeId = request.theme || config.theme;
  ensureTerminalFontsLoaded(config.fontFamily);
  return {
    themeId,
    colors: resolveTermixThemeColors(
      themeId,
      request.appTheme ?? "dark",
      config.customThemeColors,
    ),
    fontFamily: resolveTerminalFontFamily(config.fontFamily),
    fontSize: config.fontSize,
    cursorStyle: config.cursorStyle,
    cursorBlink: config.cursorBlink,
    letterSpacing: config.letterSpacing,
    lineHeight: config.lineHeight,
    scrollback: config.scrollback,
    minimumContrastRatio: config.minimumContrastRatio,
    backgroundImage: config.backgroundImage,
    backgroundImageOpacity: config.backgroundImageOpacity,
  };
}

/** What `terminal.themes` answers: every built-in theme, for a picker. */
export function listTerminalThemes(): Array<
  { id: string } & Pick<TerminalTheme, "name" | "category" | "colors">
> {
  return Object.entries(TERMINAL_THEMES)
    .filter(([id]) => id !== "termixDark" && id !== "termixLight")
    .map(([id, theme]) => ({
      id,
      name: theme.name,
      category: theme.category,
      colors: theme.colors,
    }));
}
