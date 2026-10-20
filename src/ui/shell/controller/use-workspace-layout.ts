import { useEffect } from "react";
import type { WorkspacePayload } from "@/types/ui-types";
import { createId } from "@/lib/create-id";
import { rightDockableIds } from "@/sidebar/rail-items";
import {
  buildLayoutPayload,
  resolveLayoutSplits,
  resolveLayoutTabTarget,
  snapshotData,
} from "@/shell/shell-layout";
import { addSplitTab, makeSplitTab } from "@/shell/split/split-tabs";
import { listPanes } from "@/shell/split/split-tree";
import { setShellLayoutProvider } from "@/plugin-host/shell-bridge";
import { useSplitLabel, type TabsState } from "./use-tabs";
import type { ShellRegions } from "./types";

/** Saving and applying a whole arrangement, for workspaces and plugins. */
export function useWorkspaceLayout(
  tabsState: TabsState,
  regions: ShellRegions,
) {
  const splitLabel = useSplitLabel();
  const {
    tabs,
    activeTabId,
    tabsReady,
    tabsRef,
    hostsRef,
    setTabs,
    setActiveTabId,
    suppressPaneTargetRef,
    pendingPaneTargetRef,
  } = tabsState;

  function buildWorkspacePayload(): WorkspacePayload {
    return buildLayoutPayload({
      tabs,
      activeTabId,
      sidebar: {
        left: {
          view: regions.left.view,
          open: regions.left.open,
          width: regions.left.width,
        },
        right: {
          view: regions.right.view,
          open: regions.right.view !== null,
          width: regions.right.width,
        },
      },
    });
  }

  async function applyLayout(
    payload: WorkspacePayload,
    name: string,
  ): Promise<{ skipped: string[] }> {
    // Tear down the current arrangement the same way an individual tab close does.
    for (const tab of [...tabsRef.current]) {
      tabsState.doCloseTab(tab.id);
    }
    // Tabs reopened here must not be pulled into a pane of the old layout.
    suppressPaneTargetRef.current = true;
    pendingPaneTargetRef.current = null;
    try {
      const slotIdToNewTabId = new Map<string, string>();
      const skippedTabs: string[] = [];

      for (const snapshot of payload.tabs) {
        const target = resolveLayoutTabTarget(snapshot, hostsRef.current);

        if (target.kind === "skip") {
          skippedTabs.push(snapshot.hostNameSnapshot || snapshot.label);
          continue;
        }

        if (target.kind === "singleton") {
          const newTabId = tabsState.openSingletonTab(
            snapshot.type,
            undefined,
            target.host,
            snapshotData(snapshot),
          );
          slotIdToNewTabId.set(snapshot.slotId, newTabId ?? snapshot.type);
          continue;
        }

        if (target.kind === "host") {
          const newTabId = tabsState.openTab(
            target.host,
            snapshot.type,
            {
              instanceId: createId(),
              restoredSessionId: null,
              savedLabel: snapshot.customLabel ?? snapshot.label,
            },
            { data: snapshotData(snapshot) },
          );
          slotIdToNewTabId.set(snapshot.slotId, newTabId);
        }
      }

      const splitIdBySlotId = new Map<string, string>();
      const splitIdByTabId = new Map<string, string>();
      let firstSplitId: string | null = null;
      resolveLayoutSplits(payload, slotIdToNewTabId).forEach((saved, index) => {
        const splitTab = makeSplitTab(
          createId(),
          saved.label || name || splitLabel(index + 1),
          saved.split,
        );
        if (saved.slotId) splitIdBySlotId.set(saved.slotId, splitTab.id);
        for (const pane of listPanes(saved.split.root)) {
          if (pane.tabId) splitIdByTabId.set(pane.tabId, splitTab.id);
        }
        firstSplitId ??= splitTab.id;
        setTabs((prev) => addSplitTab(prev, splitTab));
      });

      // A tab that now sits in a split is shown through its split.
      const activeSlot = payload.activeSlotId;
      const activeTabInLayout = activeSlot
        ? slotIdToNewTabId.get(activeSlot)
        : undefined;
      const activeId =
        (activeSlot ? splitIdBySlotId.get(activeSlot) : undefined) ??
        (activeTabInLayout
          ? (splitIdByTabId.get(activeTabInLayout) ?? activeTabInLayout)
          : undefined) ??
        firstSplitId ??
        "dashboard";
      setActiveTabId(activeId);

      // Older payloads predate the sidebar field, so leave the docks alone then.
      const sidebar = payload.sidebar;
      if (sidebar) {
        if (sidebar.left.view) {
          regions.left.setView(
            sidebar.left.view === "split-screen" ? "hosts" : sidebar.left.view,
          );
        }
        regions.left.setOpen(sidebar.left.open);
        if (sidebar.left.width) regions.left.setWidth(sidebar.left.width);

        const right = sidebar.right.open ? sidebar.right.view : null;
        regions.right.setView(
          right && rightDockableIds().includes(right) ? right : null,
        );
        if (sidebar.right.width) regions.right.setWidth(sidebar.right.width);
      }

      return { skipped: skippedTabs };
    } finally {
      suppressPaneTargetRef.current = false;
    }
  }

  useEffect(() => {
    setShellLayoutProvider({
      getLayout: () => (tabsReady ? buildWorkspacePayload() : null),
      applyLayout: (layout, options) =>
        applyLayout(layout as WorkspacePayload, options?.name ?? ""),
    });
  });
}
