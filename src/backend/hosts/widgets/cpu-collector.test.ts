import { describe, it, expect } from "vitest";
import { parseCpuLine } from "./cpu-collector.js";

describe("parseCpuLine", () => {
  it("parses a standard /proc/stat cpu line", () => {
    // user nice system idle iowait irq softirq
    const result = parseCpuLine("cpu  100 0 50 800 30 0 20");
    expect(result).toBeDefined();
    // idle = idle(800) + iowait(30)
    expect(result?.idle).toBe(830);
    // total = sum of all fields
    expect(result?.total).toBe(100 + 0 + 50 + 800 + 30 + 0 + 20);
  });

  it("tolerates leading/trailing whitespace", () => {
    const result = parseCpuLine("  cpu 1 2 3 4  ");
    expect(result?.total).toBe(10);
    expect(result?.idle).toBe(4);
  });

  it("returns undefined for non-cpu lines", () => {
    expect(parseCpuLine("cpu0 1 2 3 4")).toBeUndefined();
    expect(parseCpuLine("intr 12345")).toBeUndefined();
  });

  it("returns undefined when there are fewer than 4 numeric fields", () => {
    expect(parseCpuLine("cpu 1 2 3")).toBeUndefined();
  });
});
