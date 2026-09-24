import {
  getUserPreferences,
  saveUserPreferences,
  getHostSidebarPreferences,
  saveHostSidebarPreferences,
  getCredentialSidebarPreferences,
  saveCredentialSidebarPreferences,
} from "@/main-axios";
import { PRESETS, type UiPreset } from "@/types/ui-preferences";
import { sanitizeHostSidebarPreferences } from "@/types/host-sidebar-preferences";
import { sanitizeCredentialSidebarPreferences } from "@/types/credential-sidebar-preferences";
import { getRegisteredDashboardCard } from "@/dashboard/dashboard-cards-registry";

/**
 * Seeding a preset into the stores that already own their settings.
 *
 * Most preset knobs are read straight from the UI preferences blob, but a few
 * already had an owner before presets existed -- the host and credential
 * sidebar blobs, the hiddenRailTabs user preference, and a handful of
 * localStorage layout keys. Those keep their existing reader (so every
 * customize dialog, sync event and test keeps working); picking a preset just
 * writes into them once, here.
 *
 * This is the only place in the app that writes across stores, and it is
 * always user-initiated -- the settings UI confirms first, because it
 * overwrites layouts the user may have arranged by hand.
 */

// Core's own cards. A plugin's card carries its own height and panel on its
// registration (registerDashboardCard's defaultHeight/defaultPanel), read
// below, so this preset never has to spell the plugin's card id itself.
const CORE_DASHBOARD_SLOT_HEIGHTS: Record<string, number | null> = {
  stats_bar: 96,
  counters_bar: 48,
  quick_actions: 160,
  host_status: null,
  recent_activity: null,
};

/** Core cards that belong in the narrower side column rather than the main one. */
const CORE_DASHBOARD_SIDE_CARDS = new Set(["recent_activity"]);

export function buildDashboardSlots(cardIds: string[]) {
  let mainOrder = 0;
  let sideOrder = 0;
  return cardIds.map((id) => {
    const registered = getRegisteredDashboardCard(id);
    const panel =
      registered?.defaultPanel ??
      (CORE_DASHBOARD_SIDE_CARDS.has(id) ? "side" : "main");
    const height =
      registered?.defaultHeight ?? CORE_DASHBOARD_SLOT_HEIGHTS[id] ?? null;
    return {
      key: `${id}_0`,
      id,
      panel,
      order: panel === "side" ? sideOrder++ : mainOrder++,
      height,
    };
  });
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * Writes a preset's values into the stores that own them. Safe to call when
 * nothing changed; every write is idempotent.
 */
export async function applyPresetSideEffects(
  preset: Exclude<UiPreset, "custom">,
): Promise<void> {
  const target = PRESETS[preset];

  let storageMode: string | undefined;
  try {
    storageMode = (await getUserPreferences())?.storageMode;
  } catch {
    /* treat as local; the localStorage writes below still apply */
  }
  const isCloud = storageMode === "cloud";

  // Rail visibility lives on user_preferences and is mirrored to localStorage
  // with a change event, the same way the settings toggles write it.
  const hiddenRailTabs = JSON.stringify(target.rail.hiddenTabs);
  writeLocal("hiddenRailTabs", hiddenRailTabs);
  window.dispatchEvent(new Event("hiddenRailTabsChanged"));
  if (isCloud) {
    void saveUserPreferences({ hiddenRailTabs }).catch(() => {});
  }

  // Host sidebar blob keeps owning density/tags/tray; read-modify-write so
  // sort, filters and open folders survive.
  try {
    const current = await getHostSidebarPreferences();
    const next = sanitizeHostSidebarPreferences({
      ...current,
      display: {
        ...current.display,
        density: target.hostList.density,
        showTags: target.hostList.showTags,
        trayTrigger: target.hostList.trayTrigger,
      },
    });
    writeLocal("hostSidebarPreferences", JSON.stringify(next));
    window.dispatchEvent(new Event("hostSidebarPreferencesChanged"));
    if (isCloud) await saveHostSidebarPreferences(next);
  } catch {
    /* best-effort */
  }

  try {
    const current = await getCredentialSidebarPreferences();
    const next = sanitizeCredentialSidebarPreferences({
      ...current,
      display: {
        ...current.display,
        density: target.credentialList.density,
        showTags: target.credentialList.showTags,
        trayTrigger: target.hostList.trayTrigger,
      },
    });
    writeLocal("credentialSidebarPreferences", JSON.stringify(next));
    window.dispatchEvent(new Event("credentialSidebarPreferencesChanged"));
    if (isCloud) await saveCredentialSidebarPreferences(next);
  } catch {
    /* best-effort */
  }

  // Layout keys the feature tabs read directly from localStorage.
  writeLocal(
    "dashboardTab.slots",
    JSON.stringify(buildDashboardSlots(target.dashboard.enabledCards)),
  );
  window.dispatchEvent(new Event("dashboardSlotsChanged"));

  writeLocal("termix-terminal-toolbar-density", target.terminal.toolbarDensity);
  window.dispatchEvent(new Event("terminalToolbarDensityChanged"));

  writeLocal("fileManagerViewMode", target.fileManager.viewMode);
  window.dispatchEvent(new Event("fileManagerViewModeChanged"));
}
