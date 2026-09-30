import { beforeEach, describe, expect, it } from "vitest";
import {
  readExpanded,
  readSelectedPane,
  readMonitorValue,
  saveMonitorValue,
} from "../../src/frontend/monitor-storage";

beforeEach(() => localStorage.clear());
describe("per-host monitor preferences", () => {
  it("keeps identically named sessions and panes separate by host", () => {
    saveMonitorValue("expanded-1", ["same"]);
    saveMonitorValue("expanded-2", []);
    saveMonitorValue("pane-1", {
      paneId: "%0",
      sessionName: "same",
      windowIndex: 0,
    });
    expect(readExpanded(1)).toEqual(new Set(["same"]));
    expect(readExpanded(2)).toEqual(new Set());
    expect(readSelectedPane(1)?.paneId).toBe("%0");
    expect(readSelectedPane(2)).toBeNull();
  });
  it("tolerates invalid or obsolete stored values", () => {
    localStorage.setItem("termix-tmux-monitor-filter", "{broken");
    expect(readMonitorValue("filter", "")).toBe("");
    saveMonitorValue("pane-1", { paneId: "%0", windowIndex: "0" });
    expect(readSelectedPane(1)).toBeNull();
    saveMonitorValue("expanded-1", ["same", null, 3]);
    expect(readExpanded(1)).toEqual(new Set(["same"]));
  });
});
