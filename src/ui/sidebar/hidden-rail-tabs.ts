import { useEffect, useState } from "react";
import { getUserPreferences, saveUserPreferences } from "@/main-axios";

export const HIDDEN_RAIL_TABS_EVENT = "hiddenRailTabsChanged";

export function readHiddenRailTabs(): Set<string> {
  try {
    const raw = localStorage.getItem("hiddenRailTabs");
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * The one writer for hidden rail items: the rail's restore list, the
 * Navigation toggles in settings and presets all go through here, so they
 * never disagree. Saved to the account when settings sync to the cloud.
 */
export async function writeHiddenRailTabs(
  next: Iterable<string>,
): Promise<void> {
  const serialized = JSON.stringify([...next]);
  try {
    localStorage.setItem("hiddenRailTabs", serialized);
  } catch {
    // A private window refuses the write; the change still applies this session.
  }
  window.dispatchEvent(new Event(HIDDEN_RAIL_TABS_EVENT));
  try {
    const prefs = await getUserPreferences();
    if (prefs?.storageMode === "cloud") {
      await saveUserPreferences({ hiddenRailTabs: serialized });
    }
  } catch {
    // Offline; the local copy is already updated.
  }
}

/** Hides one item if it is shown, shows it if hidden. */
export function toggleHiddenRailTab(id: string): Promise<void> {
  const hidden = readHiddenRailTabs();
  if (hidden.has(id)) hidden.delete(id);
  else hidden.add(id);
  return writeHiddenRailTabs(hidden);
}

/** The hidden rail items, kept current as anything changes them. */
export function useHiddenRailTabs(): Set<string> {
  const [hidden, setHidden] = useState(readHiddenRailTabs);
  useEffect(() => {
    const handler = () => setHidden(readHiddenRailTabs());
    window.addEventListener(HIDDEN_RAIL_TABS_EVENT, handler);
    return () => window.removeEventListener(HIDDEN_RAIL_TABS_EVENT, handler);
  }, []);
  return hidden;
}
