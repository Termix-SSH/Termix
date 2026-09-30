import { describe, expect, it, vi } from "vitest";
import type { Tab } from "@/types/ui-types";
import { reconnectDisconnectedTabs } from "@/shell/reconnect-tabs";

function tab(
  id: string,
  handle: NonNullable<Tab["terminalRef"]>["current"],
  parentSplitTabId?: string,
): Tab {
  return {
    id,
    instanceId: id,
    label: id,
    type: "terminal",
    openedAt: 0,
    terminalRef: { current: handle },
    parentSplitTabId,
  };
}

describe("bulk reconnect", () => {
  it("includes hidden tabs and split children without merging sessions for the same host", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const tabs = [
      tab("hidden", { reconnectIfDisconnected: first }),
      tab("pane", { reconnectIfDisconnected: second }, "split"),
    ];
    expect(reconnectDisconnectedTabs(tabs)).toEqual({
      reconnected: 2,
      failed: 0,
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
  it("skips absent and unsupported handles and honors each provider's busy guard", () => {
    const reconnect = vi.fn();
    expect(
      reconnectDisconnectedTabs([
        tab("unmounted", null),
        tab("legacy", { reconnect, isConnected: () => false }),
        tab("busy", { reconnectIfDisconnected: () => false }),
      ]),
    ).toEqual({ reconnected: 0, failed: 0 });
    expect(reconnect).not.toHaveBeenCalled();
  });
  it("continues after one provider throws and invokes shared handles only once", () => {
    const failed = {
      reconnectIfDisconnected: vi.fn(() => {
        throw new Error("disposed");
      }),
    };
    const good = { reconnectIfDisconnected: vi.fn(() => true) };
    expect(
      reconnectDisconnectedTabs([
        tab("broken", failed),
        tab("one", good),
        tab("duplicate-reference", good),
      ]),
    ).toEqual({ reconnected: 1, failed: 1 });
    expect(good.reconnectIfDisconnected).toHaveBeenCalledOnce();
  });
});
