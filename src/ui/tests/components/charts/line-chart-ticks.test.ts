import { describe, it, expect } from "vitest";
import { pickXTicks } from "../../../components/charts/x-ticks";

const live = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(2026, 10, 4, 15, 37, i * 2)).toISOString(),
  );

describe("pickXTicks", () => {
  it("returns nothing without two points or width", () => {
    expect(pickXTicks(live(1), 0, 300)).toEqual([]);
    expect(pickXTicks(live(5), 8000, 0)).toEqual([]);
  });

  it("uses up to five labels on a wide chart", () => {
    const ts = live(60);
    expect(pickXTicks(ts, 118_000, 900)).toHaveLength(5);
  });

  it("fits fewer labels on a narrow chart and keeps the newest", () => {
    const ts = live(60);
    const ticks = pickXTicks(ts, 118_000, 220);
    expect(ticks.length).toBeLessThan(5);
    expect(ticks[ticks.length - 1]).toBe(59);
  });

  it("never lets labels touch", () => {
    for (const w of [120, 180, 220, 260, 300, 400, 600]) {
      for (const n of [2, 3, 4, 5, 8, 60]) {
        const ts = live(n);
        const range = (n - 1) * 2000;
        const ticks = pickXTicks(ts, range, w);
        const labelW = 11 * 6.2;
        const boxes = ticks.map((i) => {
          const x = (i / (n - 1)) * w;
          if (i === 0) return [x, x + labelW];
          if (i === n - 1) return [x - labelW, x];
          return [x - labelW / 2, x + labelW / 2];
        });
        for (let k = 1; k < boxes.length; k++) {
          expect(boxes[k][0]).toBeGreaterThanOrEqual(boxes[k - 1][1]);
        }
      }
    }
  });
});
