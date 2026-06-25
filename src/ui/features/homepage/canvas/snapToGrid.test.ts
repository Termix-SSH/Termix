import { describe, it, expect } from "vitest";
import { snapToGrid, snapToGridFloor } from "./snapToGrid";
import { GRID_SIZE } from "@/types/homepage-types";

describe("snapToGrid", () => {
  it("snaps to nearest grid multiple", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(GRID_SIZE)).toBe(GRID_SIZE);
    expect(snapToGrid(GRID_SIZE * 2)).toBe(GRID_SIZE * 2);
  });

  it("rounds to nearest (up when exactly halfway)", () => {
    expect(snapToGrid(GRID_SIZE / 2)).toBe(GRID_SIZE);
    expect(snapToGrid(GRID_SIZE * 1.5)).toBe(GRID_SIZE * 2);
  });

  it("rounds down when below halfway", () => {
    expect(snapToGrid(GRID_SIZE * 0.4)).toBe(0);
    expect(snapToGrid(GRID_SIZE * 1.4)).toBe(GRID_SIZE);
  });

  it("works with negative values", () => {
    expect(snapToGrid(-GRID_SIZE)).toBe(-GRID_SIZE);
    expect(snapToGrid(-GRID_SIZE * 0.4)).toBeCloseTo(0);
  });
});

describe("snapToGridFloor", () => {
  it("always rounds down to floor multiple", () => {
    expect(snapToGridFloor(GRID_SIZE - 1)).toBe(0);
    expect(snapToGridFloor(GRID_SIZE)).toBe(GRID_SIZE);
    expect(snapToGridFloor(GRID_SIZE + 1)).toBe(GRID_SIZE);
    expect(snapToGridFloor(GRID_SIZE * 2 - 1)).toBe(GRID_SIZE);
  });

  it("handles zero", () => {
    expect(snapToGridFloor(0)).toBe(0);
  });
});
