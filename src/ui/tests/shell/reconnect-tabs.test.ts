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
  it("includes hidden tabs and split children without merging sessions for the same host", async () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const tabs = [
      tab("hidden", { reconnectIfDisconnected: first }),
      tab("pane", { reconnectIfDisconnected: second }, "split"),
    ];
    expect(await reconnectDisconnectedTabs(tabs)).toEqual({
      reconnected: 2,
      failed: 0,
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
  it("skips absent and unsupported handles and honors each provider's busy guard", async () => {
    const reconnect = vi.fn();
    expect(
      await reconnectDisconnectedTabs([
        tab("unmounted", null),
        tab("legacy", { reconnect, isConnected: () => false }),
        tab("busy", { reconnectIfDisconnected: () => false }),
      ]),
    ).toEqual({ reconnected: 0, failed: 0 });
    expect(reconnect).not.toHaveBeenCalled();
  });
  it("continues after one provider throws and invokes shared handles only once", async () => {
    const failed = {
      reconnectIfDisconnected: vi.fn(() => {
        throw new Error("disposed");
      }),
    };
    const good = { reconnectIfDisconnected: vi.fn(() => true) };
    expect(
      await reconnectDisconnectedTabs([
        tab("broken", failed),
        tab("one", good),
        tab("duplicate-reference", good),
      ]),
    ).toEqual({ reconnected: 1, failed: 1 });
    expect(good.reconnectIfDisconnected).toHaveBeenCalledOnce();
  });
  it("waits for tabs drawn in a frame, which answer with a promise", async () => {
    const tabs = [
      tab("framed-up", { reconnectIfDisconnected: async () => false }),
      tab("framed-down", { reconnectIfDisconnected: async () => true }),
      tab("framed-gone", {
        reconnectIfDisconnected: () => Promise.reject(new Error("closed")),
      }),
    ];
    expect(await reconnectDisconnectedTabs(tabs)).toEqual({
      reconnected: 1,
      failed: 1,
    });
  });
});
