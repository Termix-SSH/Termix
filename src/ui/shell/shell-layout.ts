import type {
  Host,
  SplitState,
  Tab,
  WorkspacePayload,
  WorkspaceSplitSnapshot,
  WorkspaceTabSnapshot,
} from "@/types/ui-types";
import { createId } from "@/lib/create-id";
import { getTabType } from "./tab-registry";
import { isSplitTab, restoreSplitState } from "./split/split-tabs";
import { listPanes, mapTabIds } from "./split/split-tree";

/**
 * Serializing and restoring the shell's arrangement: which tabs are open,
 * how they are split, and what the docks show. This is the shell's own
 * state, so it lives here; the workspaces plugin only stores and names these
 * snapshots, through app.tabs.getLayout and applyLayout.
 */

/** Core tab types that are never part of a saved arrangement. */
const CORE_UNSAVED = new Set([
  "dashboard",
  "host-manager",
  "user-profile",
  "admin-settings",
  "split-screen",
]);

/**
 * A tab type no running plugin has registered: its plugin is disabled,
 * failed, still loading or not installed. The shell shows a placeholder for
 * it, and a layout keeps it so nothing is lost when the plugin comes back.
 */
function isUnregisteredPluginTabType(type: string): boolean {
  return !CORE_UNSAVED.has(type) && !getTabType(type);
}

export function isCapturableTabType(type: string): boolean {
  if (isUnregisteredPluginTabType(type)) return true;
  const def = getTabType(type);
  return !!def && def.inLayouts !== false;
}

// A hostless type opened for a host (a tunnel tab) is one tab per host, the
// same as when the shell opens it live.
function opensAsSingleton(type: string, hasHost: boolean): boolean {
  const def = getTabType(type);
  return !!def && (!!def.singleton || (!!def.hostless && !hasHost));
}

/**
 * Maps live tabs to snapshots, with a fresh slotId per tab. slotId is a
 * stable key within the saved payload, distinct from Tab.id, which is
 * regenerated every time a tab opens.
 */
export function buildLayoutTabSnapshots(
  tabs: Tab[],
  genSlotId: () => string = createId,
): { snapshots: WorkspaceTabSnapshot[]; slotIdByTabId: Map<string, string> } {
  const capturable = tabs.filter((tab) => isCapturableTabType(tab.type));
  const slotIdByTabId = new Map(capturable.map((tab) => [tab.id, genSlotId()]));

  const snapshots: WorkspaceTabSnapshot[] = capturable.map((tab) => ({
    slotId: slotIdByTabId.get(tab.id)!,
    type: tab.type,
    hostSyncId: tab.host?.syncId ?? null,
    hostNameSnapshot: tab.host?.name ?? null,
    label: tab.label,
    customLabel: tab.customLabel,
    data: tab.data,
  }));

  return { snapshots, slotIdByTabId };
}

/**
 * The tab's plugin payload. Payloads saved before tabs carried `data` stored
 * the fleet a fleet-inventory tab showed as a field of its own.
 */
export function snapshotData(
  snapshot: WorkspaceTabSnapshot,
): Record<string, unknown> | undefined {
  if (snapshot.data) return snapshot.data;
  // Payloads saved before tabs carried `data` kept these as fields of their own.
  const legacy: Record<string, unknown> = {};
  if (snapshot.fleetId !== undefined) legacy.fleetId = snapshot.fleetId;
  if (snapshot.initialFilePath)
    legacy.initialFilePath = snapshot.initialFilePath;
  if (snapshot.initialPath) legacy.initialPath = snapshot.initialPath;
  return Object.keys(legacy).length > 0 ? legacy : undefined;
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
  | { kind: "singleton"; host?: Host }
  | { kind: "host"; host: Host }
  | { kind: "skip" } {
  let host: Host | undefined;
  if (snapshot.hostSyncId) {
    host = allHosts.find((h) => h.syncId === snapshot.hostSyncId);
    if (!host) return { kind: "skip" };
  }

  if (opensAsSingleton(snapshot.type, !!host)) {
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
  genSlotId?: () => string;
  sidebar?: WorkspacePayload["sidebar"];
}): WorkspacePayload {
  const genSlotId = input.genSlotId ?? createId;
  const { snapshots, slotIdByTabId } = buildLayoutTabSnapshots(
    input.tabs,
    genSlotId,
  );

  const splits: WorkspaceSplitSnapshot[] = [];
  for (const tab of input.tabs) {
    if (!isSplitTab(tab)) continue;
    const root = mapTabIds(
      tab.split.root,
      (tabId) => slotIdByTabId.get(tabId) ?? null,
    );
    // A split whose tabs are all left out of layouts has nothing to restore.
    if (!listPanes(root).some((pane) => pane.tabId)) continue;
    const slotId = genSlotId();
    slotIdByTabId.set(tab.id, slotId);
    splits.push({
      slotId,
      label: tab.label,
      root,
      focusedPaneId: tab.split.focusedPaneId,
    });
  }

  return {
    version: 2,
    tabs: snapshots,
    activeSlotId: slotIdByTabId.get(input.activeTabId) ?? null,
    splits,
    ...(input.sidebar ? { sidebar: input.sidebar } : {}),
  };
}

/**
 * The splits a saved layout describes, with live tab ids. Version 1 payloads
 * held one split as a fixed mode; it comes back with no label or slotId, so
 * the caller names it.
 */
export function resolveLayoutSplits(
  payload: WorkspacePayload,
  slotIdToTabId: Map<string, string>,
): { slotId: string | null; label: string | null; split: SplitState }[] {
  const resolve = (slotId: string) => slotIdToTabId.get(slotId) ?? null;
  if (Array.isArray(payload.splits)) {
    return payload.splits.flatMap((saved) => {
      const split = restoreSplitState(saved, resolve);
      return split ? [{ slotId: saved.slotId, label: saved.label, split }] : [];
    });
  }
  if (
    typeof payload.splitMode === "string" &&
    payload.splitMode !== "none" &&
    Array.isArray(payload.paneTabIds)
  ) {
    const split = restoreSplitState(
      {
        mode: payload.splitMode,
        paneInstanceIds: payload.paneTabIds,
        rowSizes: payload.rowSizes,
        rowColSizes: payload.rowColSizes,
      },
      resolve,
    );
    return split ? [{ slotId: null, label: null, split }] : [];
  }
  return [];
}
