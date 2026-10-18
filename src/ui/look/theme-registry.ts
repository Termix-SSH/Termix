import { useSyncExternalStore } from "react";
import type { TFunction } from "i18next";

/** Follows the OS between the light and dark theme. Not a real theme. */
export const SYSTEM_THEME = "system";

export interface ThemeSwatch {
  background: string;
  panel: string;
  text: string;
}

export interface ThemeDef {
  /** Also the class put on <html> while the theme is active. */
  id: string;
  /** i18n key: core's for built-ins, the plugin namespace's for plugins. */
  label: string;
  mode: "light" | "dark";
  swatch: ThemeSwatch;
  /** Set for a plugin theme. */
  pluginId?: string;
  /** Where a plugin theme's CSS is served. Built-ins live in index.css. */
  cssHref?: string;
}

/**
 * The two themes core keeps as a fallback, with their tokens in index.css.
 * The rest come from theme plugins. A plugin theme with the same id takes
 * the built-in's place while it is installed.
 */
export const BUILTIN_THEMES: readonly ThemeDef[] = [
  {
    id: "light",
    label: "newUi.sidebar.userProfile.themeLight",
    mode: "light",
    swatch: { background: "#ffffff", panel: "#eef0f3", text: "#1f2937" },
  },
  {
    id: "dark",
    label: "newUi.sidebar.userProfile.themeDark",
    mode: "dark",
    swatch: { background: "#1a1c22", panel: "#25272e", text: "#e5e7eb" },
  },
];

const builtins = new Map(BUILTIN_THEMES.map((theme) => [theme.id, theme]));
let pluginThemes = new Map<string, ThemeDef>();
/** False until the plugin list has been read once this session. */
let pluginThemesKnown = false;
const listeners = new Set<() => void>();
let snapshot: ThemeDef[] | null = null;

function emit() {
  snapshot = null;
  for (const listener of listeners) listener();
}

/** Built-ins in their order, a plugin theme in a built-in's place, then the rest as declared. */
export function listThemes(): ThemeDef[] {
  if (!snapshot) {
    const replaced = BUILTIN_THEMES.map(
      (theme) => pluginThemes.get(theme.id) ?? theme,
    );
    const extra = [...pluginThemes.values()].filter(
      (theme) => !builtins.has(theme.id),
    );
    snapshot = [...replaced, ...extra];
  }
  return snapshot;
}

export function getTheme(id: string): ThemeDef | undefined {
  return pluginThemes.get(id) ?? builtins.get(id);
}

/** Replaces every plugin theme at once, from the plugin list. */
export function setPluginThemes(themes: ThemeDef[]): void {
  const first = !pluginThemesKnown;
  pluginThemesKnown = true;
  const next = new Map(themes.map((theme) => [theme.id, theme]));
  const same =
    next.size === pluginThemes.size &&
    [...next].every(([id, theme]) => {
      const current = pluginThemes.get(id);
      return (
        current?.cssHref === theme.cssHref &&
        current?.pluginId === theme.pluginId &&
        current?.label === theme.label &&
        current?.mode === theme.mode
      );
    });
  if (same && !first) return;
  pluginThemes = next;
  emit();
}

export function subscribeThemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemes(): ThemeDef[] {
  return useSyncExternalStore(subscribeThemes, listThemes, listThemes);
}

/** The light or dark mode a theme id stands for, following the OS for system. */
export function themeMode(id: string): "light" | "dark" {
  if (id === SYSTEM_THEME) {
    return typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  const theme = getTheme(id);
  if (theme) return theme.mode;
  // A theme that went away follows the OS, once the plugins have said so.
  return pluginThemesKnown ? themeMode(SYSTEM_THEME) : "dark";
}

/** The theme to show for a saved id: itself, or System when it is gone. */
export function effectiveThemeId(id: string): string {
  if (id === SYSTEM_THEME || getTheme(id) || !pluginThemesKnown) return id;
  return SYSTEM_THEME;
}

export function themeLabel(theme: ThemeDef, t: TFunction): string {
  if (!theme.pluginId) return t(theme.label);
  return t(`${theme.pluginId}:${theme.label}`, { defaultValue: theme.label });
}

export function arePluginThemesKnown(): boolean {
  return pluginThemesKnown;
}

/** On logout, and a test seam. */
export function resetPluginThemes(): void {
  pluginThemes = new Map();
  pluginThemesKnown = false;
  emit();
}
