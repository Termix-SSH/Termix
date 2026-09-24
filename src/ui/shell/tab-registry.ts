import type { ComponentType, Ref } from "react";
import type { Host, Tab } from "@/types/ui-types";
import { createRegistry } from "@/lib/registry";
import { viewOwner } from "@/plugin-host/view-ownership";

/**
 * The shell callbacks a registered tab may use. Same bag every tab gets, so
 * a plugin tab can do anything a core tab can without new positional props.
 */
export interface TabShellCallbacks {
  openTab: (
    host: Host | null,
    type: string,
    options?: {
      label?: string;
      forceNewTab?: boolean;
      data?: Record<string, unknown>;
    },
  ) => void;
  openSingletonTab: (
    type: string,
    options?: { label?: string; data?: Record<string, unknown> },
  ) => void;
  closeTab: (tabId: string) => void;
  renameTab: (tabId: string, label: string) => void;

  openRailView: (id: string) => void;
  /** Closes a rail view wherever it is shown, e.g. when its feature goes away. */
  closeRailView: (id: string) => void;
  /** Saves a quick-connect tab's host. Core terminal only. */
  saveQuickConnect?: (tab: Tab, host: Host) => Promise<void>;
}

export interface TabRenderProps {
  tab: Tab;
  host?: Host;
  /** The host in the shape SSH-facing components take. */
  sshHost?: Record<string, unknown>;
  label: string;
  isVisible: boolean;
  isFocusedPane: boolean;
  handleRef: Ref<unknown>;
  shell: TabShellCallbacks;
}

export interface StandaloneViewProps {
  hostId?: string;
  view: string;
  params: URLSearchParams;
}

export interface TabTypeDef {
  /** The tab type. */
  id: string;
  pluginId?: string;
  component: ComponentType<TabRenderProps>;
  icon?: ComponentType<{ className?: string }>;
  titleKey?: string;
  requiresHost?: boolean;
  noHostMessageKey?: string;
  persistent?: boolean;
  singleton?: boolean;
  session?: boolean;
  /** Whether a session tab offers "Share session". Default true. */
  shareable?: boolean;
  hostless?: boolean;
  restore?: (host: Host) => boolean;
  activityTypes?: string[];
  standalone?: ComponentType<StandaloneViewProps>;
  standaloneViews?: string[];
  panelFrame?: boolean;
  /** False keeps this tab out of saved layouts and workspaces. */
  inLayouts?: boolean;
  /** History, macros and SSH tools act on the last one of these focused. */
  commandTarget?: boolean;
  /** Paints its own background; its frame stays transparent. */
  ownBackground?: boolean;
  /** Every open is a new tab. */
  multiInstance?: boolean;
  preload?: () => Promise<unknown>;
}

const registry = createRegistry<TabTypeDef>();

export const registerTabType = registry.register;
export const unregisterTabType = registry.unregister;
export const getTabType = registry.get;
export const listTabTypes = registry.list;
export const subscribeToTabTypes = registry.subscribe;
export const useTabTypes = registry.useList;
export const resetTabTypes = registry.reset;

/** Core tab types that are saved and reopened after login. */
const CORE_PERSISTENT = new Set<string>();
/** Core tab types that hold a live session (close confirm, refresh). */
const CORE_SESSION = new Set<string>();
/** Core tab types that restore without a host. */
const CORE_HOSTLESS = new Set(["dashboard"]);

/**
 * A plugin tab type nobody registered right now: its plugin is off, failed or
 * still loading. It keeps the behaviour it had, so a saved tab survives the
 * plugin being disabled instead of being dropped by the next sync.
 */
function isOwnedButAbsent(type: string): boolean {
  return !registry.get(type) && !!viewOwner("tab", type);
}

export function isPersistentTabType(type: string): boolean {
  if (CORE_PERSISTENT.has(type)) return true;
  const def = registry.get(type);
  if (def) return !!def.persistent;
  return isOwnedButAbsent(type);
}

export function isSessionTabType(type: string): boolean {
  return CORE_SESSION.has(type) || !!registry.get(type)?.session;
}

/** Whether a session tab of this type offers "Share session". Default true. */
export function isShareableTabType(type: string): boolean {
  return registry.get(type)?.shareable !== false;
}

export function isHostlessTabType(type: string): boolean {
  return CORE_HOSTLESS.has(type) || !!registry.get(type)?.hostless;
}

/** Whether a saved tab of this type may be restored for this host. */
export function canRestoreTabType(
  type: string,
  host: Host | undefined,
): boolean {
  const def = registry.get(type);
  if (!host) return isHostlessTabType(type) || isOwnedButAbsent(type);
  return def?.restore ? def.restore(host) : true;
}

/** The tab type a recent-activity entry opens, if a registered tab claims it. */
export function tabTypeForActivity(
  activityType: string,
): TabTypeDef | undefined {
  return registry
    .list()
    .find(
      (def) =>
        def.id === activityType || def.activityTypes?.includes(activityType),
    );
}

/** The registered tab serving a `?view=` full-screen link. */
export function standaloneViewFor(view: string): TabTypeDef | undefined {
  return registry
    .list()
    .find(
      (def) =>
        def.standalone &&
        (def.id === view || def.standaloneViews?.includes(view)),
    );
}
