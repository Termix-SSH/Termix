import { useCallback, useLayoutEffect } from "react";
import { useTheme } from "@/components/theme-provider";
import { getUserPreferences, saveUserPreferences } from "@/api/open-tabs-api";
import { chooseThemeForAccount, useLookState } from "./look-store";
import { getLayoutDescriptor, getRegisteredLayout } from "./layout-registry";
import { resolveThemeId } from "./resolve-look";

const LOCAL_THEME_KEY = "vite-ui-theme";

function readLocalTheme(): string | null {
  try {
    return localStorage.getItem(LOCAL_THEME_KEY);
  } catch {
    return null;
  }
}

/**
 * Shows the theme the look settles on once it is known. A theme someone
 * picked themselves is kept in this browser too; a default is only shown,
 * so a later default change still reaches them.
 */
export function useLookTheme(layoutId: string): void {
  const { theme, setTheme } = useTheme();
  const look = useLookState();
  const layoutDefault =
    getRegisteredLayout(layoutId)?.defaultTheme ??
    getLayoutDescriptor(layoutId)?.defaultTheme;

  useLayoutEffect(() => {
    if (!look.loaded) return;
    const next = resolveThemeId(look.response, readLocalTheme(), layoutDefault);
    if (next === theme) return;
    setTheme(next, !!look.response?.themeId);
    // Only when the look itself changes, not on every theme switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look, layoutDefault]);
}

/**
 * Picks a theme for this user: shown now and kept in this browser. Unless
 * they keep settings on this device only, it is saved to their account too,
 * which is what other devices follow.
 */
export function useChooseTheme(): (themeId: string) => void {
  const { setTheme } = useTheme();
  return useCallback(
    (themeId: string) => {
      setTheme(themeId);
      void syncThemeChoice(themeId);
    },
    [setTheme],
  );
}

async function syncThemeChoice(themeId: string): Promise<void> {
  const prefs = await getUserPreferences().catch(() => null);
  // A device-only profile must not be overridden by an account choice.
  const local = prefs?.storageMode === "local";
  await chooseThemeForAccount(local ? null : themeId).catch(() => {});
  // Older clients still read the profile field.
  if (prefs?.storageMode === "cloud") {
    await saveUserPreferences({ theme: themeId }).catch(() => {});
  }
}
