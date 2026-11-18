import { afterEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  entries: {} as Record<string, unknown>,
  get: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@/main-axios", () => ({
  authApi: { get: server.get, put: server.put },
}));

import {
  isPlainValue,
  readCachedPlugin,
  resetRegistrationCache,
  trimAnswers,
  writeCachedPlugin,
  type CachedPlugin,
} from "@/plugin-host/frames/registration-cache";

const entry: CachedPlugin = {
  version: "v1",
  live: [],
  registrations: [{ rid: "panel#1", kind: "panel", raw: { id: "p" } }],
  answers: {},
  values: {},
};

server.get.mockImplementation(async () => ({
  data: { entries: server.entries },
}));
server.put.mockResolvedValue({ data: { saved: 1 } });

afterEach(() => {
  resetRegistrationCache();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  server.entries = {};
  server.get.mockClear();
  server.put.mockClear();
});

describe("registration cache", () => {
  it("still works in memory when storage throws", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("blocked");
      },
    });
    writeCachedPlugin("u", "p", entry);
    await expect(readCachedPlugin("u", "p", "v1")).resolves.toEqual(entry);
    await expect(readCachedPlugin("u", "p", "v2")).resolves.toBeNull();
    await expect(readCachedPlugin("other", "p", "v1")).resolves.toBeNull();
  });

  it("finds nothing when there is no storage at all", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(readCachedPlugin("u", "p", "v1")).resolves.toBeNull();
  });

  it("drops everything on logout", async () => {
    writeCachedPlugin("u", "p", entry);
    window.dispatchEvent(new Event("termix:logout"));
    await expect(readCachedPlugin("u", "p", "v1")).resolves.toBeNull();
  });

  it("drops answers but keeps registrations when grants change", async () => {
    writeCachedPlugin("u", "p", { ...entry, answers: { a: true } });
    window.dispatchEvent(new Event("permissionsChanged"));
    const read = await readCachedPlugin("u", "p", "v1");
    expect(read?.answers).toEqual({});
    expect(read?.registrations).toHaveLength(1);
  });

  it("starts warm from the server copy in a new browser", async () => {
    vi.stubGlobal("indexedDB", undefined);
    server.entries = {
      p: { version: "v1:g1", live: [], registrations: entry.registrations },
    };
    await expect(readCachedPlugin("u:g1", "p", "v1")).resolves.toEqual({
      ...entry,
      answers: {},
      values: {},
    });
    expect(server.get).toHaveBeenCalledTimes(1);
  });

  it("ignores a server copy from other grants or another version", async () => {
    vi.stubGlobal("indexedDB", undefined);
    server.entries = {
      p: { version: "v1:g1", live: [], registrations: entry.registrations },
    };
    await expect(readCachedPlugin("u:g2", "p", "v1")).resolves.toBeNull();
    await expect(readCachedPlugin("u:g1", "p", "v2")).resolves.toBeNull();
  });

  it("uploads changed registrations once, without answers or values", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("indexedDB", undefined);
    writeCachedPlugin("u:g1", "p", { ...entry, answers: { a: 1 } });
    writeCachedPlugin("u:g1", "q", entry);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(server.put).toHaveBeenCalledTimes(1);
    const body = server.put.mock.calls[0][1] as {
      client: string;
      entries: Record<string, Record<string, unknown>>;
    };
    expect(body.client).toBe("web");
    expect(Object.keys(body.entries)).toEqual(["p", "q"]);
    expect(body.entries.p).toEqual({
      version: "v1:g1",
      live: [],
      registrations: entry.registrations,
    });
    writeCachedPlugin("u:g1", "p", entry);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(server.put).toHaveBeenCalledTimes(1);
  });

  it("keeps only plain JSON values", () => {
    expect(isPlainValue({ a: [1, "b", null, true] })).toBe(true);
    expect(isPlainValue(() => 1)).toBe(false);
    expect(isPlainValue({ el: new Date() })).toBe(false);
    expect(isPlainValue(Number.NaN)).toBe(false);
    expect(isPlainValue({ $$typeof: Symbol("react") })).toBe(false);
  });

  it("keeps the newest answers when there are too many", () => {
    const many = Object.fromEntries(
      Array.from({ length: 2_500 }, (_, i) => [`k${i}`, i]),
    );
    const kept = trimAnswers(many);
    expect(Object.keys(kept)).toHaveLength(2_000);
    expect(kept.k2499).toBe(2_499);
    expect(kept.k0).toBeUndefined();
  });
});
