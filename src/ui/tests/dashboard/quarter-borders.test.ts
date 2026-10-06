import { describe, expect, it } from "vitest";
import { quarterBorders } from "@/dashboard/quarter-borders";

describe("quarterBorders", () => {
  it("draws a cross between four cells", () => {
    expect([0, 1, 2, 3].map((i) => quarterBorders(i, 4))).toEqual([
      "border-border border-b sm:border-r",
      "border-border border-b",
      "border-border border-b sm:border-b-0 sm:border-r",
      "border-border sm:border-b-0",
    ]);
  });

  it("stretches an odd last cell across the row", () => {
    expect(quarterBorders(2, 3)).toBe(
      "border-border sm:border-b-0 sm:col-span-2",
    );
    expect(quarterBorders(1, 3)).toBe("border-border border-b");
  });
});
