import { describe, expect, it } from "vitest";
import type { Tab } from "@/types/ui-types";
import {
  assignTabsToSplit,
  createSplitConfig,
  releaseSplitTabs,
  restoreSplitTabs,
  serializeSplitTabs,
} from "@/shell/splitTabUtils";

const session = (id: string): Tab => ({
  id,
  instanceId: `instance-${id}`,
  type: "terminal",
  label: id,
  openedAt: 1,
});

describe("split tab state", () => {
  it("moves assigned sessions under a split tab and releases removed panes", () => {
    const split: Tab = {
      id: "split-1",
      instanceId: "split-instance",
      type: "split-screen",
      label: "Split #1",
      openedAt: 1,
      splitConfig: createSplitConfig("2-way", ["a", "b"], {
        rowSizes: [100],
        rowColSizes: [[50, 50]],
      }),
    };

    const assigned = assignTabsToSplit(
      [session("a"), session("b"), split],
      split.id,
      ["a", "b"],
    );
    expect(assigned.slice(0, 2).map((tab) => tab.parentSplitTabId)).toEqual([
      split.id,
      split.id,
    ]);

    const updated = assignTabsToSplit(assigned, split.id, ["a", null]);
    expect(updated.find((tab) => tab.id === "a")?.parentSplitTabId).toBe(
      split.id,
    );
    expect(updated.find((tab) => tab.id === "b")?.parentSplitTabId).toBe(
      undefined,
    );
  });

  it("releases child sessions when the split tab closes", () => {
    const tabs = assignTabsToSplit(
      [
        session("a"),
        {
          id: "split-1",
          instanceId: "split-instance",
          type: "split-screen",
          label: "Split #1",
          openedAt: 1,
        },
      ],
      "split-1",
      ["a"],
    );
    expect(releaseSplitTabs(tabs, "split-1")).toEqual([session("a")]);
  });

  it("persists pane membership by stable instance id", () => {
    const members = [session("a"), session("b")];
    const split: Tab = {
      id: "split-1",
      instanceId: "workspace-1",
      type: "split-screen",
      label: "Production",
      openedAt: 1,
      splitConfig: createSplitConfig("2-way", ["a", "b"], {
        rowSizes: [100],
        rowColSizes: [[40, 60]],
      }),
    };
    const saved = serializeSplitTabs([...members, split]);
    const restoredMembers = [
      { ...session("new-a"), instanceId: "instance-a" },
      { ...session("new-b"), instanceId: "instance-b" },
    ];
    const restored = restoreSplitTabs(saved, restoredMembers, 2);
    const restoredSplit = restored.find((tab) => tab.type === "split-screen");

    expect(restoredSplit?.label).toBe("Production");
    expect(restoredSplit?.splitConfig?.paneTabIds.slice(0, 2)).toEqual([
      "new-a",
      "new-b",
    ]);
    expect(restoredMembers.map((tab) => tab.id)).toEqual(["new-a", "new-b"]);
    expect(
      restored
        .filter((tab) => tab.type === "terminal")
        .map((tab) => tab.parentSplitTabId),
    ).toEqual(["split-workspace-1", "split-workspace-1"]);
  });
});
