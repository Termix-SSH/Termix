import {
  Boxes,
  Braces,
  Clock,
  Fingerprint,
  Hammer,
  KeyRound,
  LayoutPanelLeft,
  LayoutTemplate,
  Network,
  Play,
  Plug,
  ScrollText,
  Server,
  Settings,
  Sparkles,
  Usb,
  User,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

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
  /** Tab-opening entries (network_graph) rather than sidebar panels. */
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
  { id: "fleets", icon: Boxes, labelKey: "nav.fleets", separatorAfter: true },
  {
    id: "automations",
    icon: Workflow,
    labelKey: "nav.automations",
    separatorAfter: true,
    promotable: true,
  },
  {
    id: "ai",
    icon: Sparkles,
    labelKey: "nav.ai",
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
    id: "workspaces",
    icon: LayoutTemplate,
    labelKey: "nav.workspaces",
    separatorAfter: true,
  },
  {
    id: "network_graph",
    icon: Network,
    labelKey: "nav.networkGraph",
    kind: "tab",
    separatorAfter: true,
  },
];

/**
 * Destinations that live outside the rail's hideable list but still need a
 * title and a mobile entry.
 */
export const RAIL_UTILITY_ITEMS: RailItemDef[] = [
  {
    id: "alerts",
    icon: Plug,
    labelKey: "nav.alerts",
    promotable: true,
    rightDockable: true,
  },
  { id: "user-profile", icon: User, labelKey: "nav.userProfile" },
  { id: "admin-settings", icon: Settings, labelKey: "nav.admin" },
];

/** Ids that may be opened in the right dock. */
export const RIGHT_DOCKABLE_IDS = [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS]
  .filter((item) => item.rightDockable)
  .map((item) => item.id);

/** Ids that may be opened as a full-width tab. */
export const PROMOTABLE_IDS = [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS]
  .filter((item) => item.promotable)
  .map((item) => item.id);

/** Ids a user is allowed to hide, mirroring HideableRailView. */
export const HIDEABLE_RAIL_IDS = RAIL_ITEMS.filter(
  (item) => !item.alwaysVisible,
).map((item) => item.id);

const LABEL_KEYS: Record<string, string> = Object.fromEntries(
  [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS].map((item) => [
    item.id,
    item.labelKey,
  ]),
);

/** Translated label for any rail destination. */
export function railItemLabel(id: string, t: (key: string) => string): string {
  const key = LABEL_KEYS[id];
  return key ? t(key) : id;
}
