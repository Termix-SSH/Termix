import { describe, expect, it } from "vitest";
import {
  BOTTOM,
  appendTile,
  flowTiles,
  gridLines,
  removeTile,
  sanitizeTiles,
  settleTiles,
  tileBottom,
  tileBoxes,
  tilesFromBoxes,
} from "../../../components/tile-grid/layout";

describe("tile grid layout", () => {
  it("settles tiles under the ones above them in the same columns", () => {
    const boxes = settleTiles([
      { id: "a", x: 0, y: 0, w: 6, h: 100 },
      { id: "b", x: 6, y: 0, w: 6, h: 50 },
      { id: "c", x: 6, y: 500, w: 6, h: 50 },
      { id: "d", x: 0, y: 900, w: 12, h: 20 },
    ]);
    const y = Object.fromEntries(boxes.map((box) => [box.id, box.y]));
    expect(y).toEqual({ a: 0, b: 0, c: 50, d: 100 });
    expect(tileBottom(boxes)).toBe(120);
  });

  it("overlaps by the gap when it is negative, for shared borders", () => {
    const boxes = settleTiles(
      [
        { id: "a", x: 0, y: 0, w: 12, h: 100 },
        { id: "b", x: 0, y: 1, w: 12, h: 100 },
      ],
      -1,
    );
    expect(boxes[1].y).toBe(99);
  });

  it("uses measured heights for tiles without a fixed one", () => {
    const boxes = tileBoxes(
      [
        { id: "a", x: 0, y: 0, w: 4, h: null },
        { id: "b", x: 0, y: 0, w: 4, h: 30 },
        { id: "c", x: 0, y: 0, w: 4 },
      ],
      { a: 77 },
      10,
    );
    expect(boxes.map((box) => box.h)).toEqual([77, 30, 10]);
  });

  it("appends at the bottom once and removes by id", () => {
    const start = [{ id: "a", x: 0, y: 0, w: 4, h: null }];
    const added = appendTile(start, { id: "b", w: 30 });
    expect(added[1]).toEqual({ id: "b", x: 0, y: BOTTOM, w: 12, h: null });
    expect(appendTile(added, { id: "b" })).toBe(added);
    expect(removeTile(added, "a").map((slot) => slot.id)).toEqual(["b"]);
  });

  it("writes settled positions back in reading order", () => {
    const slots = [
      { id: "b", x: 6, y: 300, w: 6, h: 10 },
      { id: "a", x: 0, y: 0, w: 6, h: 10 },
    ];
    const out = tilesFromBoxes(slots, settleTiles(tileBoxes(slots, {})));
    expect(out.map((slot) => [slot.id, slot.y])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });

  it("cleans saved layouts", () => {
    expect(sanitizeTiles("nope")).toEqual([]);
    expect(
      sanitizeTiles([
        { id: "a", x: 11, y: -5, w: 6, h: 3 },
        { id: "a", x: 0, y: 0, w: 4 },
        { x: 0 },
        null,
        { id: "b", x: "x", y: 10, w: 1, h: "big" },
      ]),
    ).toEqual([
      { id: "a", x: 6, y: 0, w: 6, h: 48 },
      { id: "b", x: 0, y: 10, w: 2, h: null },
    ]);
  });

  it("flows tiles into rows by width", () => {
    const out = flowTiles([
      { id: "a", w: 8 },
      { id: "b", w: 4 },
      { id: "c", w: 6 },
    ]);
    expect(out.map((slot) => [slot.id, slot.x, slot.y])).toEqual([
      ["a", 0, 0],
      ["b", 8, 0],
      ["c", 0, 160],
    ]);
  });
});

describe("gridLines", () => {
  it("draws a shared edge once, as long as the longer side", () => {
    const lines = gridLines(
      [
        { l: 0, t: 0, r: 100, b: 50 },
        { l: 100, t: 0, r: 200, b: 120 },
      ],
      200,
    );
    expect(lines.filter((line) => line.w === 1)).toEqual([
      { x: 100, y: 0, w: 1, h: 121 },
    ]);
    expect(lines.filter((line) => line.h === 1)).toEqual([
      { x: 0, y: 50, w: 101, h: 1 },
      { x: 100, y: 120, w: 100, h: 1 },
    ]);
  });

  it("leaves out the outer left, top and right edges and keeps bottoms", () => {
    expect(gridLines([{ l: 0, t: 0, r: 200, b: 80 }], 200)).toEqual([
      { x: 0, y: 80, w: 200, h: 1 },
    ]);
  });

  it("drops the very bottom line when the grid runs to the bottom of the screen", () => {
    const lines = gridLines(
      [
        { l: 0, t: 0, r: 100, b: 50 },
        { l: 100, t: 0, r: 200, b: 120 },
      ],
      200,
      true,
    );
    // The shorter column still gets its bottom line.
    expect(lines.filter((line) => line.h === 1)).toEqual([
      { x: 0, y: 50, w: 101, h: 1 },
    ]);
    expect(lines.filter((line) => line.w === 1)).toEqual([
      { x: 100, y: 0, w: 1, h: 120 },
    ]);
  });

  it("joins rows into one line across tiles", () => {
    const lines = gridLines(
      [
        { l: 0, t: 0, r: 100, b: 50 },
        { l: 100, t: 0, r: 200, b: 50 },
        { l: 0, t: 50, r: 200, b: 90 },
      ],
      200,
    );
    expect(lines.filter((line) => line.h === 1 && line.y === 50)).toEqual([
      { x: 0, y: 50, w: 200, h: 1 },
    ]);
  });
});
