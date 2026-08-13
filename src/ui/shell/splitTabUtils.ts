import type { SplitMode, SplitTabConfig, Tab } from "@/types/ui-types";

const EMPTY_PANES = 6;

export type PersistedSplitTab = {
  instanceId: string;
  label: string;
  mode: Exclude<SplitMode, "none">;
  paneInstanceIds: (string | null)[];
  rowSizes: number[];
  rowColSizes: number[][];
};

export function createSplitConfig(
  mode: Exclude<SplitMode, "none">,
  paneTabIds: (string | null)[],
  sizes: Pick<SplitTabConfig, "rowSizes" | "rowColSizes">,
): SplitTabConfig {
  return {
    mode,
    paneTabIds: [...paneTabIds, ...Array(EMPTY_PANES).fill(null)].slice(
      0,
      EMPTY_PANES,
    ),
    rowSizes: [...sizes.rowSizes],
    rowColSizes: sizes.rowColSizes.map((row) => [...row]),
  };
}

export function assignTabsToSplit(
  tabs: Tab[],
  splitTabId: string,
  paneTabIds: (string | null)[],
): Tab[] {
  const assigned = new Set(paneTabIds.filter((id): id is string => !!id));
  return tabs.map((tab) => {
    if (tab.id === splitTabId) return tab;
    if (assigned.has(tab.id)) return { ...tab, parentSplitTabId: splitTabId };
    if (tab.parentSplitTabId === splitTabId) {
      const { parentSplitTabId: _removed, ...released } = tab;
      return released;
    }
    return tab;
  });
}

export function releaseSplitTabs(tabs: Tab[], splitTabId: string): Tab[] {
  return tabs
    .filter((tab) => tab.id !== splitTabId)
    .map((tab) => {
      if (tab.parentSplitTabId !== splitTabId) return tab;
      const { parentSplitTabId: _removed, ...released } = tab;
      return released;
    });
}

export function serializeSplitTabs(tabs: Tab[]): PersistedSplitTab[] {
  const instanceIdById = new Map(tabs.map((tab) => [tab.id, tab.instanceId]));
  return tabs.flatMap((tab) => {
    if (tab.type !== "split-screen" || !tab.splitConfig) return [];
    return [
      {
        instanceId: tab.instanceId,
        label: tab.label,
        mode: tab.splitConfig.mode,
        paneInstanceIds: tab.splitConfig.paneTabIds.map((id) =>
          id ? (instanceIdById.get(id) ?? null) : null,
        ),
        rowSizes: [...tab.splitConfig.rowSizes],
        rowColSizes: tab.splitConfig.rowColSizes.map((row) => [...row]),
      },
    ];
  });
}

export function restoreSplitTabs(
  persisted: PersistedSplitTab[],
  tabs: Tab[],
  openedAt = Date.now(),
): Tab[] {
  const tabIdByInstanceId = new Map(
    tabs.map((tab) => [tab.instanceId, tab.id]),
  );
  let next = [...tabs];

  for (const saved of persisted) {
    const id = `split-${saved.instanceId}`;
    const paneTabIds = saved.paneInstanceIds.map((instanceId) =>
      instanceId ? (tabIdByInstanceId.get(instanceId) ?? null) : null,
    );
    if (!paneTabIds.some(Boolean)) continue;
    const splitTab: Tab = {
      id,
      instanceId: saved.instanceId,
      type: "split-screen",
      label: saved.label,
      openedAt,
      splitConfig: createSplitConfig(saved.mode, paneTabIds, saved),
    };
    next = assignTabsToSplit([...next, splitTab], id, paneTabIds);
  }

  return next;
}
