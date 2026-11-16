import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  resetRegistrationCache();
  vi.unstubAllGlobals();
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
