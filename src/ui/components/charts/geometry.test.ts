import { describe, it, expect } from "vitest";
import { sparklineGeometry, gaugeArc, SPARKLINE_VIEW_W } from "./geometry";

describe("sparklineGeometry", () => {
  it("returns no data for fewer than 2 points", () => {
    expect(sparklineGeometry([], 50).hasData).toBe(false);
    expect(sparklineGeometry([5], 50).hasData).toBe(false);
  });

  it("maps endpoints to the full width", () => {
    const g = sparklineGeometry([0, 100], 100, [0, 100]);
    expect(g.coords[0][0]).toBe(0);
    expect(g.coords[1][0]).toBe(SPARKLINE_VIEW_W);
  });

  it("inverts the y-axis (higher value = smaller y)", () => {
    const g = sparklineGeometry([0, 100], 100, [0, 100]);
    expect(g.coords[0][1]).toBe(100); // value 0 -> bottom
    expect(g.coords[1][1]).toBe(0); // value 100 -> top
  });

  it("respects a fixed domain (no rescaling)", () => {
    // With domain [0,100], a mid value of 50 sits at half height regardless
    // of the other points.
    const g = sparklineGeometry([50, 50, 50], 100, [0, 100]);
    for (const [, y] of g.coords) expect(y).toBe(50);
  });

  it("clamps out-of-domain values", () => {
    const g = sparklineGeometry([-20, 200], 100, [0, 100]);
    expect(g.coords[0][1]).toBe(100); // clamped to lo
    expect(g.coords[1][1]).toBe(0); // clamped to hi
  });

  it("treats null/NaN as 0", () => {
    const g = sparklineGeometry([null, undefined, NaN], 100, [0, 100]);
    expect(g.hasData).toBe(true);
    for (const [, y] of g.coords) expect(y).toBe(100);
  });

  it("builds line and area paths", () => {
    const g = sparklineGeometry([0, 100], 100, [0, 100]);
    expect(g.linePath.startsWith("M ")).toBe(true);
    expect(g.areaPath.startsWith("M 0,100")).toBe(true);
    expect(g.areaPath.endsWith("Z")).toBe(true);
  });
});

describe("gaugeArc", () => {
  it("zero value yields zero value-arc", () => {
    const a = gaugeArc(0, 50);
    expect(a.valueLen).toBe(0);
    expect(a.trackLen).toBeGreaterThan(0);
  });

  it("null is treated as 0", () => {
    expect(gaugeArc(null, 50).valueLen).toBe(0);
  });

  it("100% fills the whole track", () => {
    const a = gaugeArc(100, 50);
    expect(a.valueLen).toBeCloseTo(a.trackLen, 6);
  });

  it("track is the swept fraction of the circumference", () => {
    const a = gaugeArc(50, 50, 270);
    expect(a.trackLen).toBeCloseTo(a.circumference * 0.75, 6);
    expect(a.valueLen).toBeCloseTo(a.trackLen * 0.5, 6);
  });

  it("clamps values above 100", () => {
    const a = gaugeArc(150, 50);
    expect(a.valueLen).toBeCloseTo(a.trackLen, 6);
  });
});
