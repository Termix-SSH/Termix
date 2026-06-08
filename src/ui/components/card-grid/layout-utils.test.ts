import { describe, it, expect } from "vitest";
import {
  clampColumns,
  nextColSpan,
  sortSlots,
  reorderSlots,
  addSlot,
  removeSlot,
  setColSpan,
  setHeight,
  heightToRowSpan,
  MIN_TILE_HEIGHT,
} from "./layout-utils";
import type { GridSlot } from "./types";

function slot(id: string, order: number, colSpan: 1 | 2 | 3 = 1): GridSlot {
  return { id, order, colSpan, height: null };
}

describe("clampColumns", () => {
  it("clamps into 1..4 and rounds", () => {
    expect(clampColumns(0)).toBe(1);
    expect(clampColumns(1)).toBe(1);
    expect(clampColumns(4)).toBe(4);
    expect(clampColumns(9)).toBe(4);
    expect(clampColumns(2.6)).toBe(3);
    expect(clampColumns(NaN)).toBe(1);
  });
});

describe("nextColSpan", () => {
  it("cycles 1->2->3->1 when 3+ columns", () => {
    expect(nextColSpan(1, 3)).toBe(2);
    expect(nextColSpan(2, 3)).toBe(3);
    expect(nextColSpan(3, 3)).toBe(1);
  });
  it("caps at the column count", () => {
    expect(nextColSpan(1, 2)).toBe(2);
    expect(nextColSpan(2, 2)).toBe(1);
    expect(nextColSpan(1, 1)).toBe(1);
  });
});

describe("sortSlots", () => {
  it("returns a stable copy ordered by order", () => {
    const input = [slot("b", 2), slot("a", 1), slot("c", 3)];
    const out = sortSlots(input);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(input);
  });
});

describe("reorderSlots", () => {
  const base = [slot("a", 0), slot("b", 1), slot("c", 2)];

  it("moves a slot to the front and renumbers densely", () => {
    const out = reorderSlots(base, "c", 0);
    expect(out.map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(out.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it("moves a slot to the end", () => {
    const out = reorderSlots(base, "a", 99);
    expect(out.map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(out.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it("is a no-op-ish renumber for an unknown id", () => {
    const out = reorderSlots(base, "zzz", 0);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(out.map((s) => s.order)).toEqual([0, 1, 2]);
  });
});

describe("addSlot", () => {
  it("appends with clamped colSpan and next order", () => {
    const out = addSlot(
      [slot("a", 0)],
      { id: "b", label: "B", defaultColSpan: 3 },
      2,
    );
    expect(out).toHaveLength(2);
    const added = out.find((s) => s.id === "b")!;
    expect(added.order).toBe(1);
    expect(added.colSpan).toBe(2); // clamped to columns
  });
  it("does not duplicate an existing id", () => {
    const input = [slot("a", 0)];
    expect(addSlot(input, { id: "a", label: "A" }, 3)).toBe(input);
  });
});

describe("removeSlot", () => {
  it("removes and renumbers", () => {
    const out = removeSlot([slot("a", 0), slot("b", 1), slot("c", 2)], "b");
    expect(out.map((s) => s.id)).toEqual(["a", "c"]);
    expect(out.map((s) => s.order)).toEqual([0, 1]);
  });
});

describe("setColSpan / setHeight", () => {
  it("sets colSpan for the matching id only", () => {
    const out = setColSpan([slot("a", 0, 1), slot("b", 1, 1)], "a", 2);
    expect(out.find((s) => s.id === "a")!.colSpan).toBe(2);
    expect(out.find((s) => s.id === "b")!.colSpan).toBe(1);
  });
  it("enforces a minimum tile height", () => {
    const out = setHeight([slot("a", 0)], "a", 10);
    expect(out[0].height).toBe(MIN_TILE_HEIGHT);
    const out2 = setHeight([slot("a", 0)], "a", 300);
    expect(out2[0].height).toBe(300);
  });
});

describe("heightToRowSpan", () => {
  const unit = 8;
  const gap = 12;
  it("returns at least one row for tiny tiles", () => {
    expect(heightToRowSpan(0, unit, gap)).toBe(1);
    expect(heightToRowSpan(5, unit, gap)).toBe(1);
  });
  it("grows the row span with height (taller -> more rows)", () => {
    const short = heightToRowSpan(200, unit, gap);
    const tall = heightToRowSpan(400, unit, gap);
    expect(tall).toBeGreaterThan(short);
  });
  it("rounds up so content is never clipped", () => {
    // 200px content: ceil((200 + 12) / (8 + 12)) = ceil(10.6) = 11
    expect(heightToRowSpan(200, unit, gap)).toBe(11);
  });
});
