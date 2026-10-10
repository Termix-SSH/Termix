import { createContext, useContext } from "react";

/**
 * True inside a Settings tab page. Panels built from accordion sections then
 * show only the open one, flat, since the page already names it.
 */
export const SettingsEmbedContext = createContext(false);

export function useSettingsEmbedded(): boolean {
  return useContext(SettingsEmbedContext);
}
