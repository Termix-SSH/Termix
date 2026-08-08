import { describe, expect, it } from "vitest";
import {
  computeDropSortOrder,
  renumberSiblings,
} from "../../sidebar/reorder-utils";

describe("computeDropSortOrder", () => {
  it("returns the gap value when the list is empty", () => {
    expect(computeDropSortOrder(null, null)).toBe(1000);
  });

  it("returns before + gap when dropped at the end", () => {
    expect(computeDropSortOrder({ sortOrder: 1000 }, null)).toBe(2000);
  });

  it("returns after - gap when dropped at the start", () => {
    expect(computeDropSortOrder(null, { sortOrder: 1000 })).toBe(0);
  });

  it("returns the midpoint when dropped between two neighbors", () => {
    expect(
      computeDropSortOrder({ sortOrder: 1000 }, { sortOrder: 2000 }),
    ).toBe(1500);
  });

  it("returns null when the gap between neighbors is exhausted", () => {
    expect(
      computeDropSortOrder({ sortOrder: 1000 }, { sortOrder: 1001 }),
    ).toBeNull();
  });

  it("treats a missing sortOrder on a neighbor as null", () => {
    expect(
      computeDropSortOrder({ sortOrder: null }, { sortOrder: 1000 }),
    ).toBe(0);
  });
});

describe("renumberSiblings", () => {
  it("assigns evenly-spaced sortOrder values in list order", () => {
    expect(
      renumberSiblings([{ id: "a" }, { id: "b" }, { id: "c" }]),
    ).toEqual([
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1000 },
      { id: "c", sortOrder: 2000 },
    ]);
  });

  it("returns an empty array for an empty list", () => {
    expect(renumberSiblings([])).toEqual([]);
  });
});
