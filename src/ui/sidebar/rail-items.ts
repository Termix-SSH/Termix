import {
  Cloud,
  KeyRound,
  Plug,
  Server,
  LibraryBig,
  Puzzle,
  Settings,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { usePermissions } from "@/hooks/use-permissions";
import { useAreaPreferences } from "@/contexts/UiPreferencesContext";
import { useSyncAttentionCount } from "@/hooks/use-sync-status";
import { isElectron } from "@/lib/electron";
import { createRegistry } from "@/lib/registry";
import { getPanel } from "@/shell/panel-registry";
import { getTabType } from "@/shell/tab-registry";

/**
 * The one list of navigation destinations.
 *
 * This used to be duplicated in four places -- AppRail's button array, the
 * visibility toggles in UserProfilePanel, AppShell's sidebar title map, and
 * the mobile bar's own primary/more lists -- which drifted: half the sidebar
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
  /** The rail band it sits in. Defaults to "tools". */
  group?: RailGroup;
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
  /** A plugin item that stays visible in the Simple preset. */
  simplePreset?: boolean;
  /** Registered but not shown, e.g. while its feature is switched off. */
  hidden?: boolean;
  /** Places a registered item after this id instead of at the end. */
  after?: string;
  /** Tie-break among registered items. */
  order?: number;
  /** Set for items a plugin registered. */
  pluginId?: string;
  /** Role permission the user needs to see it at all, as a full id. */
  permission?: string;
  /** "footer" renders it at the bottom of the rail, above the profile. */
  placement?: "main" | "footer";
  /** Called as a hook by the rail; a positive number shows as a badge. */
  useBadge?: () => number | null | undefined;
}

/** Things you keep, things you do, and the instance itself. */
export type RailGroup = "objects" | "tools" | "system";
export const RAIL_GROUP_ORDER: RailGroup[] = ["objects", "tools", "system"];

export const RAIL_ITEMS: RailItemDef[] = [
  {
    id: "hosts",
    icon: Server,
    labelKey: "nav.hosts",
    mobilePrimary: true,
    group: "objects",
  },
  {
    id: "credentials",
    icon: KeyRound,
    labelKey: "nav.credentials",
    separatorAfter: true,
    group: "objects",
  },
  {
    id: "connections",
    icon: Plug,
    labelKey: "nav.connections",
    separatorAfter: true,
    rightDockable: true,
    group: "tools",
  },
  {
    id: "quick-connect",
    icon: Zap,
    labelKey: "nav.quickConnect",
    separatorAfter: true,
    mobilePrimary: true,
    group: "tools",
  },
  {
    id: "sync",
    icon: Cloud,
    labelKey: "nav.sync",
    electronOnly: true,
    placement: "footer",
    group: "system",
    useBadge: useSyncAttentionCount,
  },
  {
    id: "plugins",
    icon: Puzzle,
    labelKey: "nav.plugins",
    kind: "tab",
    placement: "footer",
    group: "system",
    permission: "admin.plugins.manage",
  },
];

/** Main rail items split into their bands, in band order, empty bands left out. */
export function groupRailItems(
  items: RailItemDef[],
): { group: RailGroup; items: RailItemDef[] }[] {
  return RAIL_GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => (item.group ?? "tools") === group),
  })).filter((band) => band.items.length > 0);
}

/**
 * Rail items registered by plugins at runtime. Reactive, because a plugin can
 * be enabled or disabled while the app is open and the rail, the mobile bar
 * and the Navigation toggles all have to follow.
 */
const registeredRailItems = createRegistry<RailItemDef>();

export function registerRailItem(def: RailItemDef): () => void {
  return registeredRailItems.register(def);
}

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

/**
 * Drops items gated on a permission the user lacks. Until permissions load,
 * gated items stay hidden rather than flashing in and out.
 */
export function permittedRailItems(
  items: RailItemDef[],
  permissions: { has: (permission: string) => boolean; loaded: boolean },
): RailItemDef[] {
  if (!items.some((item) => item.permission)) return items;
  return items.filter(
    (item) =>
      !item.permission ||
      (permissions.loaded && permissions.has(item.permission)),
  );
}

/**
 * visibleRailItems() as a hook, re-rendering when plugins change it, without
 * the items the user's permissions hide.
 */
export function useRailItems(): RailItemDef[] {
  const items = useSyncExternalStore(
    registeredRailItems.subscribe,
    railItemsSnapshot,
    railItemsSnapshot,
  );
  const { has, loaded } = usePermissions();
  const { order } = useAreaPreferences("rail");
  return useMemo(
    () => applyRailOrder(permittedRailItems(items, { has, loaded }), order),
    [items, has, loaded, order],
  );
}

/**
 * Items in the user's order. Listed ids come first in that order within the
 * default sequence; unlisted ones keep their default place relative to it.
 */
export function applyRailOrder(
  items: RailItemDef[],
  order: string[] | undefined,
): RailItemDef[] {
  if (!order || order.length === 0) return items;
  const rank = new Map(order.map((id, index) => [id, index]));
  const listed = items
    .filter((item) => rank.has(item.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  let next = 0;
  return items.map((item) => (rank.has(item.id) ? listed[next++] : item));
}

/**
 * The order after moving `id` to sit before `beforeId` (or to the end of its
 * band when null), as a full list of the given items' ids.
 */
export function moveRailItem(
  items: RailItemDef[],
  id: string,
  beforeId: string | null,
): string[] {
  const ids = items.map((item) => item.id).filter((other) => other !== id);
  const at = beforeId ? ids.indexOf(beforeId) : -1;
  if (at < 0) {
    const group = items.find((item) => item.id === id)?.group ?? "tools";
    const lastInBand = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.id !== id && (item.group ?? "tools") === group)
      .map(({ item }) => ids.indexOf(item.id))
      .pop();
    ids.splice(lastInBand === undefined ? ids.length : lastInBand + 1, 0, id);
  } else {
    ids.splice(at, 0, id);
  }
  return ids;
}

/** Places outside the rail that still need a title, like the Settings tab. */
export const RAIL_UTILITY_ITEMS: RailItemDef[] = [
  { id: "settings", icon: Settings, labelKey: "nav.settings" },
  { id: "host-manager", icon: LibraryBig, labelKey: "nav.manage" },
];

/** Ids that may be opened in the right dock. */
export function rightDockableIds(): string[] {
  return [...mergedRailItems(), ...RAIL_UTILITY_ITEMS]
    .filter((item) => item.rightDockable)
    .map((item) => item.id);
}

/** Ids that may be opened as a full-width tab: a tab type or a panel to show. */
export function promotableIds(): string[] {
  return [...mergedRailItems(), ...RAIL_UTILITY_ITEMS]
    .filter(
      (item) => item.promotable && (getTabType(item.id) || getPanel(item.id)),
    )
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
