/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react";
import type { ThemeId } from "@/types/ui-types";
import {
  SYSTEM_THEME,
  effectiveThemeId,
  getTheme,
  useThemes,
} from "@/look/theme-registry";
import { applyThemeCss } from "@/look/theme-css";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: ThemeId;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: ThemeId;
  /** Pass persist false to show a theme without keeping it in this browser. */
  setTheme: (theme: ThemeId, persist?: boolean) => void;
  setThemePreview: (theme: ThemeId | null) => void;
};

const initialState: ThemeProviderState = {
  theme: "dark",
  setTheme: () => null,
  setThemePreview: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

/** The class last put on <html>, in case its theme has since gone away. */
let appliedClass: string | null = null;

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<ThemeId>(
    () => (localStorage.getItem(storageKey) as ThemeId) || defaultTheme,
  );
  const [previewTheme, setPreviewTheme] = useState<ThemeId | null>(null);
  // Plugin themes arrive after login; the class and CSS follow them.
  const themes = useThemes();

  // A saved theme whose plugin is gone shows as System.
  const shownTheme = effectiveThemeId(theme);
  const activeTheme = previewTheme ?? shownTheme;

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove(...themes.map((entry) => entry.id));
    if (appliedClass) root.classList.remove(appliedClass);

    const applied =
      activeTheme === SYSTEM_THEME
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : activeTheme;
    root.classList.add(applied);
    appliedClass = applied;
    applyThemeCss(applied, getTheme(applied));
  }, [activeTheme, themes]);

  const value = {
    theme: shownTheme,
    setTheme: (theme: ThemeId, persist = true) => {
      if (persist) localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
    setThemePreview: (preview: ThemeId | null) => {
      setPreviewTheme(preview);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};
