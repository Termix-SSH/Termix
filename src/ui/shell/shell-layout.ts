import type {
  Host,
  Tab,
  WorkspacePayload,
  WorkspaceTabSnapshot,
} from "@/types/ui-types";
import { getTabType } from "./tab-registry";

/**
 * Serializing and restoring the shell's arrangement: which tabs are open,
 * how they are split, and what the docks show. This is the shell's own
 * state, so it lives here; the workspaces plugin only stores and names these
 * snapshots, through app.tabs.getLayout and applyLayout.
 */

/**
 * Core tab types worth saving in a layout. "dashboard" is left out on
 * purpose: the shell always keeps one alive as the fallback tab, so it is
 * not a meaningful part of an arrangement.
 */
const CORE_CAPTURABLE = new Set([
  "files",
  "tunnel",
  "tmux_monitor",
  "serial",
  "homepage",
  "termix-id",
  "session-logs",
  "snippets",
  "macros",
  "history",
  "ssh-tools",
]);

/** Core types reopened as singletons, with an optional preselected host. */
const CORE_SINGLETON = new Set([
  "tunnel",
  "tmux_monitor",
  "homepage",
  "termix-id",
  "session-logs",
  "snippets",
  "macros",
  "history",
  "ssh-tools",
]);

/** Core tab types that are never part of a saved arrangement. */
const CORE_UNSAVED = new Set([
  "dashboard",
  "local-terminal",
  "host-manager",
  "user-profile",
  "admin-settings",
  "split-screen",
  "sftp",
]);

/**
 * A tab type no running plugin has registered: its plugin is disabled,
 * failed, still loading or not installed. The shell shows a placeholder for
 * it, and a layout keeps it so nothing is lost when the plugin comes back.
 */
export function isUnregisteredPluginTabType(type: string): boolean {
  return (
    !CORE_UNSAVED.has(type) &&
    !CORE_CAPTURABLE.has(type) &&
    type !== "serial" &&
    !getTabType(type)
  );
}

export function isCapturableTabType(type: string): boolean {
  if (CORE_CAPTURABLE.has(type)) return true;
  if (isUnregisteredPluginTabType(type)) return true;
  const def = getTabType(type);
  return !!def && def.inLayouts !== false;
}

function opensAsSingleton(type: string): boolean {
  if (CORE_SINGLETON.has(type)) return true;
  const def = getTabType(type);
  return !!def && (!!def.singleton || !!def.hostless);
}

function createSlotId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Maps live tabs to snapshots, with a fresh slotId per tab. slotId is a
 * stable key within the saved payload, distinct from Tab.id, which is
 * regenerated every time a tab opens.
 */
export function buildLayoutTabSnapshots(
  tabs: Tab[],
  genSlotId: () => string = createSlotId,
): { snapshots: WorkspaceTabSnapshot[]; slotIdByTabId: Map<string, string> } {
  const capturable = tabs.filter((tab) => isCapturableTabType(tab.type));
  const slotIdByTabId = new Map(capturable.map((tab) => [tab.id, genSlotId()]));

  const snapshots: WorkspaceTabSnapshot[] = capturable.map((tab) => ({
    slotId: slotIdByTabId.get(tab.id)!,
    type: tab.type,
    hostSyncId: tab.type === "serial" ? null : (tab.host?.syncId ?? null),
    hostNameSnapshot: tab.host?.name ?? null,
    label: tab.label,
    customLabel: tab.customLabel,
    initialFilePath: tab.initialFilePath,
    initialPath: tab.initialPath,
    data: tab.data,
    serialConfig: tab.type === "serial" ? tab.serialConfig : undefined,
  }));

  return { snapshots, slotIdByTabId };
}

/** Remaps a slotId-keyed array (paneTabIds shape) to live tab ids. */
export function remapSlotIds(
  slotIds: (string | null)[],
  slotIdToTabId: Map<string, string>,
): (string | null)[] {
  return slotIds.map((slotId) =>
    slotId != null ? (slotIdToTabId.get(slotId) ?? null) : null,
  );
}

/**
 * The tab's plugin payload. Payloads saved before tabs carried `data` stored
 * the fleet a fleet-inventory tab showed as a field of its own.
 */
export function snapshotData(
  snapshot: WorkspaceTabSnapshot,
): Record<string, unknown> | undefined {
  if (snapshot.data) return snapshot.data;
  return snapshot.fleetId !== undefined
    ? { fleetId: snapshot.fleetId }
    : undefined;
}

/**
 * How to reopen one saved tab. "singleton" types go through
 * openSingletonTab with an optional host; "host" types need a resolved host
 * to open at all.
 */
export function resolveLayoutTabTarget(
  snapshot: WorkspaceTabSnapshot,
  allHosts: Host[],
):
  | { kind: "serial" }
  | { kind: "singleton"; host?: Host }
  | { kind: "host"; host: Host }
  | { kind: "skip" } {
  if (snapshot.type === "serial") {
    return snapshot.serialConfig ? { kind: "serial" } : { kind: "skip" };
  }

  let host: Host | undefined;
  if (snapshot.hostSyncId) {
    host = allHosts.find((h) => h.syncId === snapshot.hostSyncId);
    if (!host) return { kind: "skip" };
  }

  if (opensAsSingleton(snapshot.type)) {
    return { kind: "singleton", host };
  }

  // Reopened as a placeholder rather than dropped, so applying a workspace
  // while a plugin is off does not quietly lose its tabs.
  if (!host && isUnregisteredPluginTabType(snapshot.type)) {
    return { kind: "singleton" };
  }

  return host ? { kind: "host", host } : { kind: "skip" };
}

export function buildLayoutPayload(input: {
  tabs: Tab[];
  activeTabId: string;
  splitMode: WorkspacePayload["splitMode"];
  paneTabIds: (string | null)[];
  rowSizes: number[];
  rowColSizes: number[][];
  genSlotId?: () => string;
  sidebar?: WorkspacePayload["sidebar"];
}): WorkspacePayload {
  const { snapshots, slotIdByTabId } = buildLayoutTabSnapshots(
    input.tabs,
    input.genSlotId,
  );

  return {
    version: 1,
    tabs: snapshots,
    activeSlotId: slotIdByTabId.get(input.activeTabId) ?? null,
    splitMode: input.splitMode,
    paneTabIds: input.paneTabIds.map((tabId) =>
      tabId != null ? (slotIdByTabId.get(tabId) ?? null) : null,
    ),
    rowSizes: input.rowSizes,
    rowColSizes: input.rowColSizes,
    ...(input.sidebar ? { sidebar: input.sidebar } : {}),
  };
}
