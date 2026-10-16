import { getUserPreferences, saveUserPreferences } from "@/api/open-tabs-api";

export type RailPreference =
  | "pinAppRail"
  | "expandAppRailOnHover"
  | "showPinAppRailButton"
  | "appRailHoverPushesContent";

const CHANGE_EVENT: Record<RailPreference, string> = {
  pinAppRail: "pinAppRailChanged",
  expandAppRailOnHover: "expandAppRailOnHoverChanged",
  showPinAppRailButton: "showPinAppRailButtonChanged",
  appRailHoverPushesContent: "appRailHoverPushesContentChanged",
};

/** Kept on this device only; the server has no column for it. */
const LOCAL_ONLY: ReadonlySet<RailPreference> = new Set([
  "appRailHoverPushesContent",
]);

// pinAppRail and showPinAppRailButton default off, expandAppRailOnHover
// defaults on, so each key needs its own read rather than a shared
// === "true" check.
export function readRailPreference(key: RailPreference): boolean {
  const stored = localStorage.getItem(key);
  return key === "expandAppRailOnHover"
    ? stored !== "false"
    : stored === "true";
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
  if (LOCAL_ONLY.has(key)) return;
  void getUserPreferences()
    .then((preferences) => {
      if (preferences.storageMode === "cloud") {
        return saveUserPreferences({ [key]: value });
      }
    })
    .catch(() => {});
}
