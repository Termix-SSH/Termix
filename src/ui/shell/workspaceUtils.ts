import type {
  Host,
  Tab,
  TabType,
  WorkspacePayload,
  WorkspaceTabSnapshot,
} from "@/types/ui-types";

// "dashboard" is deliberately excluded: AppShell always keeps a dashboard
// tab alive as the fallback when every other tab closes, so it isn't a
// meaningful part of a saved arrangement and shouldn't count toward
// tabCount or be reopened on apply.
export const WORKSPACE_CAPTURABLE_TYPES: TabType[] = [
  "terminal",
  "rdp",
  "vnc",
  "telnet",
  "host-metrics",
  "proxmox-stats",
  "files",
  "docker",
  "tunnel",
  "network_graph",
  "tmux_monitor",
  "serial",
  "homepage",
  "fleet-inventory",
  "termix-id",
  "alerts",
  "session-logs",
  "snippets",
  "history",
  "ssh-tools",
  "automations",
];

export const HOSTLESS_WORKSPACE_TAB_TYPES: TabType[] = [
  "tunnel",
  "network_graph",
  "tmux_monitor",
  "homepage",
  "fleet-inventory",
  "docker",
  "termix-id",
  "alerts",
  "session-logs",
  "snippets",
  "history",
  "ssh-tools",
  "automations",
];

/**
 * Maps live tabs to WorkspaceTabSnapshots, generating a fresh slotId per tab.
 * slotId is a stable key within the saved payload, distinct from Tab.id
 * (which is regenerated every time a tab is opened).
 */
export function buildWorkspaceTabSnapshots(
  tabs: Tab[],
  genSlotId: () => string = () => crypto.randomUUID(),
): { snapshots: WorkspaceTabSnapshot[]; slotIdByTabId: Map<string, string> } {
  const capturable = tabs.filter((t) =>
    WORKSPACE_CAPTURABLE_TYPES.includes(t.type),
  );
  const slotIdByTabId = new Map(capturable.map((t) => [t.id, genSlotId()]));

  const snapshots: WorkspaceTabSnapshot[] = capturable.map((t) => ({
    slotId: slotIdByTabId.get(t.id)!,
    type: t.type,
    hostSyncId: t.type === "serial" ? null : (t.host?.syncId ?? null),
    hostNameSnapshot: t.host?.name ?? null,
    label: t.label,
    customLabel: t.customLabel,
    initialFilePath: t.initialFilePath,
    initialPath: t.initialPath,
    fleetId: t.fleetId,
    serialConfig: t.type === "serial" ? t.serialConfig : undefined,
  }));

  return { snapshots, slotIdByTabId };
}

/** Remaps a slotId-keyed array (paneTabIds shape) to live tab ids via a slotId->tabId map. */
export function remapSlotIds(
  slotIds: (string | null)[],
  slotIdToTabId: Map<string, string>,
): (string | null)[] {
  return slotIds.map((slotId) =>
    slotId != null ? (slotIdToTabId.get(slotId) ?? null) : null,
  );
}

/**
 * Resolves how to (re)open a single workspace-payload tab on apply.
 *
 * "singleton" covers every rail-singleton tab type (dashboard/tunnel/docker/
 * etc.) whether or not a host was resolved for it - these always go through
 * openSingletonTab, which accepts an optional preselected host. "host" is
 * for genuinely per-host tab types (terminal/rdp/files/...), which always
 * need a resolved host to open at all.
 */
export function resolveWorkspaceTabTarget(
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

  if (HOSTLESS_WORKSPACE_TAB_TYPES.includes(snapshot.type)) {
    return { kind: "singleton", host };
  }

  return host ? { kind: "host", host } : { kind: "skip" };
}

export function buildWorkspacePayload(input: {
  tabs: Tab[];
  activeTabId: string;
  splitMode: WorkspacePayload["splitMode"];
  paneTabIds: (string | null)[];
  rowSizes: number[];
  rowColSizes: number[][];
  genSlotId?: () => string;
  sidebar?: WorkspacePayload["sidebar"];
}): WorkspacePayload {
  const { snapshots, slotIdByTabId } = buildWorkspaceTabSnapshots(
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
