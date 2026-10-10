import { describe, expect, it } from "vitest";
import {
  CORE_ONBOARDING_STEPS,
  LEGACY_SEEN,
  MAX_SEEN_ENTRIES,
  mergeSeen,
  pluginStepKey,
  sanitizeSeen,
} from "@/types/onboarding";

describe("onboarding seen map", () => {
  it("keys plugin steps by plugin id", () => {
    expect(pluginStepKey("remote-desktop", "guacd")).toBe(
      "remote-desktop:guacd",
    );
  });

  it("merges per key keeping the higher version", () => {
    expect(mergeSeen({ a: 2, b: 1 }, { a: 1, b: 3, c: 1 })).toEqual({
      a: 2,
      b: 3,
      c: 1,
    });
  });

  it("drops invalid entries", () => {
    expect(
      sanitizeSeen({ ok: 1, zero: 0, neg: -1, frac: 1.2, str: "1", "": 1 }),
    ).toEqual({ ok: 1 });
    expect(sanitizeSeen(["a"])).toEqual({});
    expect(sanitizeSeen(null)).toEqual({});
  });

  it("caps the number of entries", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < MAX_SEEN_ENTRIES + 20; i++) big[`k${i}`] = 1;
    expect(Object.keys(sanitizeSeen(big))).toHaveLength(MAX_SEEN_ENTRIES);
  });

  it("legacy seen covers every core step at launch", () => {
    expect(Object.keys(LEGACY_SEEN).sort()).toEqual(
      Object.keys(CORE_ONBOARDING_STEPS).sort(),
    );
  });
});
