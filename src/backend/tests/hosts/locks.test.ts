import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: { warn: vi.fn() },
}));

const {
  assertHostsUnlocked,
  assertManualCreateAllowed,
  clearHostLocks,
  hasHostLocks,
  hostLock,
  HostLockedError,
  manualCreateBlockedBy,
  provideHostLocks,
  requireManualCreate,
  requireUnlockedHost,
} = await import("../../hosts/locks.js");

const provider = (locked: number[], allowManualCreate = true) => ({
  isLocked: (hostId: number) => locked.includes(hostId),
  note: (hostId: number) => `id ${hostId}`,
  allowManualCreate: () => allowManualCreate,
});

function fakeRes() {
  const res = {
    code: 0,
    body: null as unknown,
    status(code: number) {
      res.code = code;
      return { json: (body: unknown) => (res.body = body) };
    },
  };
  return res;
}

afterEach(() => clearHostLocks());

describe("host locks", () => {
  it("reports nothing without providers", () => {
    expect(hasHostLocks()).toBe(false);
    expect(hostLock(1)).toBeNull();
    expect(() => assertHostsUnlocked([1, 2])).not.toThrow();
    expect(manualCreateBlockedBy()).toBeNull();
  });

  it("names the plugin and note for a locked host", () => {
    provideHostLocks("cfg", "Config", provider([3]));
    expect(hostLock(3)).toEqual({
      pluginId: "cfg",
      pluginName: "Config",
      note: "id 3",
    });
    expect(hostLock(4)).toBeNull();
    expect(() => assertHostsUnlocked([4, 3])).toThrow(HostLockedError);
  });

  it("lets the locking plugin through", () => {
    provideHostLocks("cfg", "Config", provider([3], false));
    expect(() => assertHostsUnlocked([3], "cfg")).not.toThrow();
    expect(() => assertManualCreateAllowed("cfg")).not.toThrow();
    expect(() => assertManualCreateAllowed()).toThrow(/managed by Config/);
  });

  it("drops a provider when removed", () => {
    const remove = provideHostLocks("cfg", "Config", provider([3], false));
    remove();
    expect(hostLock(3)).toBeNull();
    expect(manualCreateBlockedBy()).toBeNull();
  });

  it("never locks when a provider throws", () => {
    provideHostLocks("cfg", "Config", {
      isLocked: () => {
        throw new Error("broken");
      },
      note: () => null,
      allowManualCreate: () => {
        throw new Error("broken");
      },
    });
    expect(hostLock(1)).toBeNull();
    expect(manualCreateBlockedBy()).toBeNull();
  });
});

describe("lock route guards", () => {
  it("answers 403 HOST_LOCKED for a locked :id", () => {
    provideHostLocks("cfg", "Config", provider([7]));
    const res = fakeRes();
    const next = vi.fn();
    requireUnlockedHost({ params: { id: "7" } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(403);
    expect(res.body).toMatchObject({ code: "HOST_LOCKED", lockedBy: "cfg" });

    requireUnlockedHost({ params: { id: "8" } }, fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("blocks manual creates only while a provider says so", () => {
    const next = vi.fn();
    requireManualCreate({}, fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);

    provideHostLocks("cfg", "Config", provider([], false));
    const res = fakeRes();
    requireManualCreate({}, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.code).toBe(403);
  });
});
