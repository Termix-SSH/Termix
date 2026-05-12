import { createContext, useContext, useEffect, useState } from "react";
import type { ThemeId } from "@/types/ui-types";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: ThemeId;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  setThemePreview: (theme: ThemeId | null) => void;
};

const ALL_THEME_CLASSES = [
  "light",
  "dark",
  "dracula",
  "catppuccin",
  "nord",
  "solarized",
  "tokyo-night",
  "one-dark",
  "gruvbox",
];

const initialState: ThemeProviderState = {
  theme: "dark",
  setTheme: () => null,
  setThemePreview: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

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

  const activeTheme = previewTheme ?? theme;

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove(...ALL_THEME_CLASSES);

    if (activeTheme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(activeTheme);
  }, [activeTheme]);

  const value = {
    theme,
    setTheme: (theme: ThemeId) => {
      localStorage.setItem(storageKey, theme);
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
