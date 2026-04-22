/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react";

type Theme =
  | "dark"
  | "light"
  | "system"
  | "dracula"
  | "gentlemansChoice"
  | "midnightEspresso"
  | "catppuccinMocha";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  setThemePreview: (theme: Theme | null) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  setThemePreview: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme,
  );
  const [previewTheme, setPreviewTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove(
      "light",
      "dark",
      "dracula",
      "gentlemansChoice",
      "midnightEspresso",
      "catppuccinMocha",
    );

    const activeTheme = previewTheme || theme;

    if (activeTheme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(activeTheme);

    const darkCustomThemes: Theme[] = [
      "dracula",
      "gentlemansChoice",
      "midnightEspresso",
      "catppuccinMocha",
    ];
    if (darkCustomThemes.includes(activeTheme)) {
      root.classList.add("dark");
    }
  }, [theme, previewTheme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
    setThemePreview: (theme: Theme | null) => {
      setPreviewTheme(theme);
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
