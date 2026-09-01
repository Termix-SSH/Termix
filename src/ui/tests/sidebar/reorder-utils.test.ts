import { describe, expect, it } from "vitest";
import {
  computeDropSortOrder,
  planReorder,
  renumberSiblings,
  type ReorderRow,
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
    expect(computeDropSortOrder({ sortOrder: 1000 }, { sortOrder: 2000 })).toBe(
      1500,
    );
  });

  it("returns null when the gap between neighbors is exhausted", () => {
    expect(
      computeDropSortOrder({ sortOrder: 1000 }, { sortOrder: 1001 }),
    ).toBeNull();
  });

  it("treats a missing sortOrder on a neighbor as null", () => {
    expect(computeDropSortOrder({ sortOrder: null }, { sortOrder: 1000 })).toBe(
      0,
    );
  });
});

describe("renumberSiblings", () => {
  it("assigns evenly-spaced sortOrder values in list order", () => {
    expect(renumberSiblings([{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual([
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1000 },
      { id: "c", sortOrder: 2000 },
    ]);
  });

  it("returns an empty array for an empty list", () => {
    expect(renumberSiblings([])).toEqual([]);
  });
});

describe("planReorder", () => {
  const rows: ReorderRow[] = [
    { key: "host:1", parentKey: "folder:A", sortOrder: 0 },
    { key: "host:2", parentKey: "folder:A", sortOrder: 1000 },
    { key: "host:3", parentKey: "folder:A", sortOrder: 2000 },
    { key: "host:9", parentKey: "folder:B", sortOrder: 0 },
    { key: "host:10", parentKey: "folder:B", sortOrder: 1000 },
  ];

  it("returns null when dropped on itself", () => {
    expect(planReorder(rows, "host:1", "host:1", "before")).toBeNull();
  });

  it("returns null for an unknown dragged or target row", () => {
    expect(planReorder(rows, "host:99", "host:1", "before")).toBeNull();
    expect(planReorder(rows, "host:1", "host:99", "before")).toBeNull();
  });

  it("returns null when the drop lands on the slot it already occupies", () => {
    expect(planReorder(rows, "host:1", "host:2", "before")).toBeNull();
    expect(planReorder(rows, "host:2", "host:1", "after")).toBeNull();
  });

  it("computes a midpoint within the same folder", () => {
    const plan = planReorder(rows, "host:1", "host:2", "after");
    expect(plan).toEqual({
      positions: [{ key: "host:1", sortOrder: 1500 }],
      movedTo: null,
    });
  });

  it("scopes neighbours to the target's folder, not every row", () => {
    // host:1 dropped after host:9 must compare against folder B's rows, and
    // a cross-folder drop renumbers the destination so the arriving row's
    // old-folder sortOrder can't decide its new position.
    const plan = planReorder(rows, "host:1", "host:9", "after");
    expect(plan).toEqual({
      positions: [
        { key: "host:9", sortOrder: 0 },
        { key: "host:1", sortOrder: 1000 },
        { key: "host:10", sortOrder: 2000 },
      ],
      movedTo: "folder:B",
    });
  });

  it("reports the new parent when the drop crosses folders", () => {
    const plan = planReorder(rows, "host:10", "host:2", "before");
    expect(plan?.movedTo).toBe("folder:A");
  });

  it("keeps movedTo null for a same-folder drop", () => {
    expect(planReorder(rows, "host:3", "host:1", "before")?.movedTo).toBeNull();
  });

  it("drops at the end of the target folder", () => {
    const plan = planReorder(rows, "host:1", "host:3", "after");
    expect(plan?.positions).toEqual([{ key: "host:1", sortOrder: 3000 }]);
  });

  it("renumbers the destination group when the gap is exhausted", () => {
    const tight: ReorderRow[] = [
      { key: "host:1", parentKey: "folder:A", sortOrder: 1000 },
      { key: "host:2", parentKey: "folder:A", sortOrder: 1001 },
      { key: "host:3", parentKey: "folder:A", sortOrder: 5000 },
    ];
    const plan = planReorder(tight, "host:3", "host:2", "before");
    expect(plan).toEqual({
      positions: [
        { key: "host:1", sortOrder: 0 },
        { key: "host:3", sortOrder: 1000 },
        { key: "host:2", sortOrder: 2000 },
      ],
      movedTo: null,
    });
  });

  it("numbers the whole group when siblings have no sortOrder yet", () => {
    // Hosts start at null, and null sorts last under manual sort, so a lone
    // value for the moved row would say nothing about where it landed.
    const sparse: ReorderRow[] = [
      { key: "host:1", parentKey: "folder:A" },
      { key: "host:2", parentKey: "folder:A" },
    ];
    expect(
      planReorder(sparse, "host:2", "host:1", "before")?.positions,
    ).toEqual([
      { key: "host:2", sortOrder: 0 },
      { key: "host:1", sortOrder: 1000 },
    ]);
  });

  it("numbers the whole group when only some siblings are ordered", () => {
    const partial: ReorderRow[] = [
      { key: "host:1", parentKey: "folder:A", sortOrder: 0 },
      { key: "host:2", parentKey: "folder:A" },
      { key: "host:3", parentKey: "folder:A", sortOrder: 1000 },
    ];
    expect(
      planReorder(partial, "host:3", "host:1", "before")?.positions,
    ).toEqual([
      { key: "host:3", sortOrder: 0 },
      { key: "host:1", sortOrder: 1000 },
      { key: "host:2", sortOrder: 2000 },
    ]);
  });
});

describe("planReorder cross-folder placement", () => {
  it("numbers the destination so the drop lands where it was aimed", () => {
    // The arriving row carries sortOrder 5 from its old folder, which would
    // otherwise sort it to the front of the destination regardless of aim.
    const rows: ReorderRow[] = [
      { key: "host:1", parentKey: "folder:A", sortOrder: 5 },
      { key: "host:8", parentKey: "folder:B", sortOrder: 1000 },
      { key: "host:9", parentKey: "folder:B", sortOrder: 2000 },
    ];
    const plan = planReorder(rows, "host:1", "host:9", "before");
    expect(plan?.movedTo).toBe("folder:B");
    expect(plan?.positions).toEqual([
      { key: "host:8", sortOrder: 0 },
      { key: "host:1", sortOrder: 1000 },
      { key: "host:9", sortOrder: 2000 },
    ]);
  });

  it("still writes only the moved row for a same-folder drop", () => {
    const rows: ReorderRow[] = [
      { key: "host:1", parentKey: "folder:A", sortOrder: 0 },
      { key: "host:2", parentKey: "folder:A", sortOrder: 1000 },
      { key: "host:3", parentKey: "folder:A", sortOrder: 2000 },
    ];
    expect(planReorder(rows, "host:1", "host:2", "after")?.positions).toEqual([
      { key: "host:1", sortOrder: 1500 },
    ]);
  });
});
