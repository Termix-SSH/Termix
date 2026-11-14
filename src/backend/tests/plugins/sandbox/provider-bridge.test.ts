import { describe, expect, it, vi } from "vitest";
import {
  MAX_LOCKED_HOSTS,
  readLockSnapshot,
  remoteStatusProvider,
  SnapshotLockProvider,
} from "../../../plugins/sandbox/provider-bridge.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("host lock reports", () => {
  it("keeps valid ids and short notes, and drops the rest", () => {
    const read = readLockSnapshot({
      hosts: [
        [1, "managed"],
        [2, null],
        [-3, "x"],
        ["4", "x"],
        [5, "n".repeat(900)],
        "junk",
      ],
      allowManualCreate: false,
    });
    expect([...read.locked.keys()]).toEqual([1, 2, 5]);
    expect(read.locked.get(5)).toHaveLength(500);
    expect(read.allowManualCreate).toBe(false);
  });

  it("refuses a report without a list or with too many hosts", () => {
    expect(() => readLockSnapshot({})).toThrow(/hosts list/);
    const many = Array.from({ length: MAX_LOCKED_HOSTS + 1 }, (_, i) => [
      i + 1,
      null,
    ]);
    expect(() => readLockSnapshot({ hosts: many })).toThrow(/Too many/);
  });

  it("answers from the last report", () => {
    const provider = new SnapshotLockProvider({ hosts: [[7, "from a file"]] });
    expect(provider.isLocked(7)).toBe(true);
    expect(provider.note(7)).toBe("from a file");
    expect(provider.allowManualCreate()).toBe(true);
    provider.update({ hosts: [[8, null]], allowManualCreate: false });
    expect(provider.isLocked(7)).toBe(false);
    expect(provider.note(8)).toBeNull();
    expect(provider.allowManualCreate()).toBe(false);
  });

  it("keeps the old report when a new one is bad", () => {
    const provider = new SnapshotLockProvider({ hosts: [[7, null]] });
    expect(() => provider.update({ hosts: "nope" })).toThrow();
    expect(provider.isLocked(7)).toBe(true);
  });
});

function fakeRemote() {
  const store = new Map<number, { status: string; lastChecked: string }>([
    [1, { status: "online", lastChecked: "t1" }],
    [2, { status: "offline", lastChecked: "t2" }],
  ]);
  return {
    store,
    remote: {
      start: vi.fn(),
      stop: vi.fn(),
      statusesFor: vi.fn(async () => new Map(store)),
      refresh: vi.fn(async () => {}),
      check: vi.fn(async (id: number) => store.get(id) ?? null),
      reportLogin: vi.fn(),
      registerPort: vi.fn(async () => drop),
      getIntervalSeconds: vi.fn(async () => 45),
      setIntervalSeconds: vi.fn(async () => {}),
      getMany: vi.fn(async (ids: number[]) =>
        ids.map((id) => [id, store.get(id) ?? null]),
      ),
    },
  };
}
const drop = vi.fn();

describe("remote host status", () => {
  it("answers get from what the plugin last said and asks again in the background", async () => {
    const { remote, store } = fakeRemote();
    const provider = remoteStatusProvider(remote);
    expect(provider.get(1)).toBeNull();
    provider.get(2);
    await tick();
    await tick();
    expect(remote.getMany).toHaveBeenCalledTimes(1);
    expect(remote.getMany).toHaveBeenCalledWith([1, 2]);
    expect(provider.get(1)).toEqual({ status: "online", lastChecked: "t1" });

    store.delete(1);
    provider.get(1);
    await tick();
    await tick();
    expect(provider.get(1)).toBeNull();
  });

  it("fills the cache from statusesFor and check, and drops bad entries", async () => {
    const { remote, store } = fakeRemote();
    store.set(3, { status: "sideways", lastChecked: "t3" });
    const provider = remoteStatusProvider(remote);
    const all = await provider.statusesFor("u1", [1, 2, 3]);
    expect([...all.keys()]).toEqual([1, 2]);
    expect(remote.statusesFor).toHaveBeenCalledWith("u1", [1, 2, 3]);
    expect(provider.get(2)).toEqual({ status: "offline", lastChecked: "t2" });
    store.set(4, { status: "reachable", lastChecked: "t4" });
    expect(await provider.check(4)).toEqual({
      status: "reachable",
      lastChecked: "t4",
    });
    expect(provider.get(4)?.status).toBe("reachable");
  });

  it("passes the rest through and turns a port's disposer into a plain one", async () => {
    const { remote } = fakeRemote();
    const provider = remoteStatusProvider(remote);
    provider.start();
    provider.reportLogin(1, { ok: true });
    const resolve = () => 22;
    const unregister = provider.registerPort("ssh", resolve);
    expect(remote.registerPort).toHaveBeenCalledWith("ssh", resolve);
    unregister();
    await tick();
    expect(drop).toHaveBeenCalled();
    expect(await provider.getIntervalSeconds()).toBe(45);
    await provider.setIntervalSeconds(60);
    expect(remote.setIntervalSeconds).toHaveBeenCalledWith(60);
    expect(remote.start).toHaveBeenCalled();
    expect(remote.reportLogin).toHaveBeenCalledWith(1, { ok: true });
  });

  it("refuses a provider without the methods core needs", () => {
    expect(() => remoteStatusProvider({ get: () => null })).toThrow(
      /needs statusesFor/,
    );
  });

  it("reports a failing background call instead of throwing", async () => {
    const { remote } = fakeRemote();
    remote.getMany.mockRejectedValueOnce(new Error("process gone"));
    const errors: unknown[] = [];
    const provider = remoteStatusProvider(remote, (e) => errors.push(e));
    expect(provider.get(1)).toBeNull();
    await tick();
    await tick();
    expect(errors).toHaveLength(1);
  });
});
