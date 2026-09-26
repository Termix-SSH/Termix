import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSyncStatus = vi.hoisted(() => vi.fn());
const notifySyncChanged = vi.hoisted(() => vi.fn());

vi.mock("@/lib/electron", () => ({ isElectron: () => true }));
vi.mock("@/api/sync-api", () => ({ getSyncStatus }));
vi.mock("@/lib/linked-server", () => ({ notifySyncChanged }));

const store = await import("@/lib/sync-status");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("sync status store", () => {
  let unsubscribe: () => void = () => {};
  const events: string[] = [];
  const record = (event: Event) => events.push(event.type);

  beforeEach(() => {
    events.length = 0;
    for (const type of ["hosts:refresh", "termix:hosts-changed"]) {
      window.addEventListener(type, record);
    }
  });

  afterEach(() => {
    unsubscribe();
    for (const type of ["hosts:refresh", "termix:hosts-changed"]) {
      window.removeEventListener(type, record);
    }
  });

  it("polls while subscribed and tells views to reload after a pass", async () => {
    getSyncStatus.mockResolvedValue({
      linked: true,
      lastSyncAt: "2026-09-25T10:00:00Z",
      entities: [],
    });
    const listener = vi.fn();
    unsubscribe = store.subscribeSyncStatus(listener);
    await flush();
    expect(store.getSyncStatusSnapshot()?.linked).toBe(true);
    expect(listener).toHaveBeenCalled();
    // The first read only sets the baseline.
    expect(events).toEqual([]);

    store.setSyncStatus({
      linked: true,
      lastSyncAt: "2026-09-25T10:05:00Z",
      entities: [],
    });
    expect(events).toEqual(["hosts:refresh", "termix:hosts-changed"]);
    expect(notifySyncChanged).toHaveBeenCalled();
  });
});
