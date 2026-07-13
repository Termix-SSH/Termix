import { describe, expect, it, vi } from "vitest";
import { ServerStatusStore } from "./server-status-store";

describe("ServerStatusStore", () => {
  it("notifies only listeners for hosts whose status value changed", () => {
    const store = new ServerStatusStore();
    store.setEnabledHostIds(new Set([1, 2, 3]));

    const on1 = vi.fn();
    const on2 = vi.fn();
    const onAll = vi.fn();
    store.subscribeHost(1, on1);
    store.subscribeHost(2, on2);
    store.subscribeAll(onAll);

    store.applyStatuses(
      new Map([
        [1, { status: "online", lastChecked: "t1" }],
        [2, { status: "offline", lastChecked: "t1" }],
        [3, { status: "online", lastChecked: "t1" }],
      ]),
    );
    expect(on1).toHaveBeenCalledTimes(1);
    expect(on2).toHaveBeenCalledTimes(1);
    expect(onAll).toHaveBeenCalledTimes(1);

    on1.mockClear();
    on2.mockClear();
    onAll.mockClear();

    // Only host 2 flips; host 1 lastChecked changes but status stays online.
    store.applyStatuses(
      new Map([
        [1, { status: "online", lastChecked: "t2" }],
        [2, { status: "online", lastChecked: "t2" }],
        [3, { status: "online", lastChecked: "t2" }],
      ]),
    );
    expect(on1).not.toHaveBeenCalled();
    expect(on2).toHaveBeenCalledTimes(1);
    expect(onAll).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the status map is unchanged", () => {
    const store = new ServerStatusStore();
    store.setEnabledHostIds(new Set([1]));
    store.applyStatuses(
      new Map([[1, { status: "online", lastChecked: "t1" }]]),
    );

    const on1 = vi.fn();
    store.subscribeHost(1, on1);
    store.applyStatuses(
      new Map([[1, { status: "online", lastChecked: "t9" }]]),
    );
    expect(on1).not.toHaveBeenCalled();
    expect(store.getStatus(1)).toBe("online");
  });

  it("returns offline for disabled hosts", () => {
    const store = new ServerStatusStore();
    store.applyStatuses(new Map([[5, { status: "online", lastChecked: "t" }]]));
    expect(store.getStatus(5)).toBe("offline");
    store.setEnabledHostIds(new Set([5]));
    expect(store.getStatus(5)).toBe("online");
  });

  it("emits meta listeners when initial load completes", () => {
    const store = new ServerStatusStore();
    const onMeta = vi.fn();
    store.subscribeMeta(onMeta);
    store.setInitialLoadComplete(true);
    expect(onMeta).toHaveBeenCalledTimes(1);
    store.setInitialLoadComplete(true);
    expect(onMeta).toHaveBeenCalledTimes(1);
  });
});
