import {
  ArrowLeftRight,
  Braces,
  Clock,
  Fingerprint,
  Hammer,
  KeyRound,
  LayoutPanelLeft,
  Network,
  Play,
  Plug,
  ScrollText,
  Server,
  Settings,
  TerminalSquare,
  Usb,
  User,
  Zap,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import { isElectron } from "@/lib/electron";
import { createRegistry } from "@/lib/registry";

/**
 * The one list of navigation destinations.
 *
 * This used to be duplicated in four places -- AppRail's button array, the
 * visibility toggles in UserProfilePanel, AppShell's sidebar title map, and
 * MobileBottomBar's own primary/more lists -- which drifted: half the sidebar
 * titles were hardcoded English, the alerts entry had no visibility toggle,
 * and the mobile bar ignored hidden tabs entirely. Everything now derives from
 * here, so adding a destination is a single edit.
 */
export interface RailItemDef {
  /** Matches RailView, or a TabType for entries that open a tab instead. */
  id: string;
  icon: LucideIcon;
  /** i18n key; every label goes through t() so nothing is hardcoded English. */
  labelKey: string;
  /** Tab-opening entries rather than sidebar panels. */
  kind?: "tab";
  /** Always-available destinations that users cannot hide. */
  alwaysVisible?: boolean;
  /** Renders a separator after this item in the rail. */
  separatorAfter?: boolean;
  /** Shown on the mobile bottom bar's primary row rather than its More menu. */
  mobilePrimary?: boolean;
  /**
   * Can also open as a full-width tab in the main area, via ctrl/middle-click
   * or the rail context menu. The id doubles as the TabType.
   */
  promotable?: boolean;
  /**
   * Can be opened in the right dock. Reference panels only -- editors stay in
   * the left sidebar, which is the only dock that widens for them.
   */
  rightDockable?: boolean;
  /** Desktop app only. Hidden in the browser build, including its toggle. */
  electronOnly?: boolean;
  /** False keeps it out of the Navigation visibility toggles. */
  hideable?: boolean;
  /** Registered but not shown, e.g. while its feature is switched off. */
  hidden?: boolean;
  /** Places a registered item after this id instead of at the end. */
  after?: string;
  /** Tie-break among registered items. */
  order?: number;
  /** Set for items a plugin registered. */
  pluginId?: string;
}

export const RAIL_ITEMS: RailItemDef[] = [
  { id: "hosts", icon: Server, labelKey: "nav.hosts", mobilePrimary: true },
  {
    id: "credentials",
    icon: KeyRound,
    labelKey: "nav.credentials",
    separatorAfter: true,
  },
  {
    id: "port-forwarding",
    icon: Network,
    labelKey: "nav.portForwarding",
    electronOnly: true,
    separatorAfter: true,
  },
  {
    id: "termix-id",
    icon: Fingerprint,
    labelKey: "nav.termixId",
    separatorAfter: true,
    promotable: true,
  },
  {
    id: "connections",
    icon: Plug,
    labelKey: "nav.connections",
    separatorAfter: true,
    rightDockable: true,
  },
  {
    id: "collab",
    icon: Presentation,
    labelKey: "nav.collab",
    separatorAfter: true,
  },
  {
    id: "quick-connect",
    icon: Zap,
    labelKey: "nav.quickConnect",
    separatorAfter: true,
    mobilePrimary: true,
  },
  { id: "serial", icon: Usb, labelKey: "nav.serial", separatorAfter: true },
  {
    id: "ssh-tools",
    icon: Hammer,
    labelKey: "nav.sshTools",
    separatorAfter: true,
    mobilePrimary: true,
    promotable: true,
    rightDockable: true,
  },
  {
    id: "sftp",
    icon: ArrowLeftRight,
    labelKey: "nav.sftp",
    separatorAfter: true,
  },
  {
    id: "snippets",
    icon: Play,
    labelKey: "nav.snippets",
    separatorAfter: true,
    mobilePrimary: true,
    promotable: true,
    rightDockable: true,
  },
  {
    id: "macros",
    icon: Braces,
    labelKey: "nav.macros",
    separatorAfter: true,
    promotable: true,
    rightDockable: true,
  },
  {
    id: "history",
    icon: Clock,
    labelKey: "nav.history",
    separatorAfter: true,
    promotable: true,
    rightDockable: true,
  },
  {
    id: "session-logs",
    icon: ScrollText,
    labelKey: "nav.sessionLogs",
    separatorAfter: true,
    promotable: true,
    rightDockable: true,
  },
  {
    id: "split-screen",
    icon: LayoutPanelLeft,
    labelKey: "nav.splitScreen",
    separatorAfter: true,
  },
  {
    id: "local-terminal",
    icon: TerminalSquare,
    labelKey: "nav.localTerminal",
    kind: "tab",
    separatorAfter: true,
    electronOnly: true,
  },
];

/**
 * Rail items registered by plugins at runtime. Reactive, because a plugin can
 * be enabled or disabled while the app is open and the rail, the mobile bar
 * and the Navigation toggles all have to follow.
 */
const registeredRailItems = createRegistry<RailItemDef>();

export function registerRailItem(def: RailItemDef): () => void {
  return registeredRailItems.register(def);
}

export function unregisterRailItem(id: string): void {
  registeredRailItems.unregister(id);
}

export const subscribeToRailItems = registeredRailItems.subscribe;

/** Registered items, hidden ones included. */
export const listRegisteredRailItems = registeredRailItems.list;

/**
 * Core items in their fixed order, with each registered item placed after
 * the item its `after` names, or at the end. Hidden items are left out.
 */
function mergedRailItems(): RailItemDef[] {
  const merged = [...RAIL_ITEMS];
  const plugins = [...registeredRailItems.list()]
    .filter((item) => !item.hidden)
    .sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
    );
  for (const item of plugins) {
    let at = item.after
      ? merged.findIndex((existing) => existing.id === item.after)
      : -1;
    if (at < 0) {
      merged.push(item);
      continue;
    }
    // Items sharing an anchor keep their own order after it.
    while (
      at + 1 < merged.length &&
      merged[at + 1].pluginId &&
      merged[at + 1].after === item.after
    ) {
      at++;
    }
    merged.splice(at + 1, 0, item);
  }
  return merged;
}

/**
 * Rail items available in the current build. Electron-only destinations are
 * dropped in the browser build so they never reach the rail, the mobile bar,
 * or the visibility toggles.
 */
export function visibleRailItems(): RailItemDef[] {
  const electron = isElectron();
  return mergedRailItems().filter((item) => !item.electronOnly || electron);
}

let railSnapshot: RailItemDef[] | null = null;
registeredRailItems.subscribe(() => {
  railSnapshot = null;
});

function railItemsSnapshot(): RailItemDef[] {
  if (!railSnapshot) railSnapshot = visibleRailItems();
  return railSnapshot;
}

/** visibleRailItems() as a hook, re-rendering when plugins change it. */
export function useRailItems(): RailItemDef[] {
  return useSyncExternalStore(
    registeredRailItems.subscribe,
    railItemsSnapshot,
    railItemsSnapshot,
  );
}

/**
 * Destinations that live outside the rail's hideable list but still need a
 * title and a mobile entry.
 */
export const RAIL_UTILITY_ITEMS: RailItemDef[] = [
  { id: "user-profile", icon: User, labelKey: "nav.userProfile" },
  { id: "admin-settings", icon: Settings, labelKey: "nav.admin" },
];

/** Ids that may be opened in the right dock. */
export function rightDockableIds(): string[] {
  return [...mergedRailItems(), ...RAIL_UTILITY_ITEMS]
    .filter((item) => item.rightDockable)
    .map((item) => item.id);
}

/** Ids that may be opened as a full-width tab. */
export function promotableIds(): string[] {
  return [...mergedRailItems(), ...RAIL_UTILITY_ITEMS]
    .filter((item) => item.promotable)
    .map((item) => item.id);
}

/** Ids a user is allowed to hide from Appearance > Sidebar > Navigation. */
export function hideableRailIds(): string[] {
  return visibleRailItems()
    .filter((item) => !item.alwaysVisible && item.hideable !== false)
    .map((item) => item.id);
}

/** Whether a rail view is one of core's own, rather than a plugin's. */
export function isCoreRailView(id: string): boolean {
  return [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS].some((item) => item.id === id);
}

/** Translated label for any rail destination, including registered ones. */
export function railItemLabel(id: string, t: (key: string) => string): string {
  const key =
    [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS].find((item) => item.id === id)
      ?.labelKey ?? registeredRailItems.get(id)?.labelKey;
  return key ? t(key) : id;
}

/** Test seam. */
export function resetRegisteredRailItems(): void {
  registeredRailItems.reset();
}
