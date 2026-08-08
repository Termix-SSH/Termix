import { getUserPreferences, saveUserPreferences } from "@/api/open-tabs-api";

export type RailPreference = "pinAppRail" | "expandAppRailOnHover";

const CHANGE_EVENT: Record<RailPreference, string> = {
  pinAppRail: "pinAppRailChanged",
  expandAppRailOnHover: "expandAppRailOnHoverChanged",
};

// pinAppRail defaults off, expandAppRailOnHover defaults on, so each key needs
// its own read rather than a shared === "true" check.
export function readRailPreference(key: RailPreference): boolean {
  const stored = localStorage.getItem(key);
  return key === "pinAppRail" ? stored === "true" : stored !== "false";
}

/**
 * Single write path for the app rail display preferences. Persists to
 * localStorage, notifies every mounted listener so the rail and the settings
 * panel stay in step, then mirrors to the server when the user is on cloud
 * storage.
 */
export function setRailPreference(key: RailPreference, value: boolean): void {
  localStorage.setItem(key, String(value));
  window.dispatchEvent(new Event(CHANGE_EVENT[key]));
  void getUserPreferences()
    .then((preferences) => {
      if (preferences.storageMode === "cloud") {
        return saveUserPreferences({ [key]: value });
      }
    })
    .catch(() => {});
}
