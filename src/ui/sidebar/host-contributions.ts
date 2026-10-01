import type { ComponentType } from "react";
import type { Host } from "@/types/ui-types";
import { byOrderThenId, createRegistry } from "@/lib/registry";
import type { TabShellCallbacks } from "@/shell/tab-registry";

type Icon = ComponentType<{ className?: string; size?: number | string }>;

/**
 * What a plugin adds to a host: ways to connect or open a tool, badges on its
 * row, and entries in its context menu. The host list, quick connect and the
 * command palette all read these instead of knowing about each protocol.
 */
export interface HostActionDef {
  id: string;
  pluginId?: string;
  titleKey: string;
  icon: Icon;
  kind: "connect" | "open";
  priority?: number;
  tabType?: string;
  when: (host: Host) => boolean;
  run?: (host: Host, shell: TabShellCallbacks) => void;
  tray?: boolean;
  copyUrlView?: string;
  /** Where the dashboard's host status list sends a click. */
  overview?: boolean;
  /** Offered as a button in Quick Connect, opening tabType. */
  quickConnect?: boolean;
  order?: number;
  /** A label worked out per host, e.g. a single endpoint's name. */
  label?: (host: Host) => string | undefined;
  /** Several targets: two or more become a picker, one runs directly. */
  items?: (host: Host) => {
    id: string;
    label: string;
    run: (host: Host, shell: TabShellCallbacks) => void;
  }[];
}

export interface HostBadgeDef {
  id: string;
  pluginId?: string;
  when: (host: Host) => boolean;
  component: ComponentType<{ host: Host }>;
  order?: number;
}

export interface HostContextMenuItemDef {
  id: string;
  pluginId?: string;
  titleKey: string;
  icon?: Icon;
  when: (host: Host) => boolean;
  run: (host: Host, shell: TabShellCallbacks) => void;
  order?: number;
}

const actions = createRegistry<HostActionDef>(byOrderThenId);
const badges = createRegistry<HostBadgeDef>(byOrderThenId);
const menuItems = createRegistry<HostContextMenuItemDef>(byOrderThenId);

export const registerHostAction = actions.register;
export const useHostActions = actions.useList;
export const listHostActions = actions.list;
export const registerHostBadge = badges.register;
export const useHostBadges = badges.useList;
export const registerHostContextMenuItem = menuItems.register;
export const useHostContextMenuItems = menuItems.useList;

/** A predicate from a plugin must never take the host list down with it. */
function safeWhen(predicate: (host: Host) => boolean, host: Host): boolean {
  try {
    return predicate(host);
  } catch {
    return false;
  }
}

export function hostActionsFor(
  all: HostActionDef[],
  host: Host,
  kind?: HostActionDef["kind"],
): HostActionDef[] {
  return all.filter(
    (action) => (!kind || action.kind === kind) && safeWhen(action.when, host),
  );
}

/** The connect action a click on the host should run, by priority. */
export function defaultConnectAction(
  all: HostActionDef[],
  host: Host,
): HostActionDef | undefined {
  return hostActionsFor(all, host, "connect").sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  )[0];
}

export function hostBadgesFor(all: HostBadgeDef[], host: Host): HostBadgeDef[] {
  return all.filter((badge) => safeWhen(badge.when, host));
}

export function hostMenuItemsFor(
  all: HostContextMenuItemDef[],
  host: Host,
): HostContextMenuItemDef[] {
  return all.filter((item) => safeWhen(item.when, host));
}

/** Runs an action, falling back to opening its tab type. */
export function runHostAction(
  action: HostActionDef,
  host: Host,
  shell: TabShellCallbacks,
): void {
  if (action.run) action.run(host, shell);
  else if (action.tabType) shell.openTab(host, action.tabType);
}

export function resetHostContributions(): void {
  actions.reset();
  badges.reset();
  menuItems.reset();
}
