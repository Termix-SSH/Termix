import { describe, expect, it } from "vitest";
import { masonryColumns } from "@/components/card-masonry";

describe("masonryColumns", () => {
  it("stacks into one column when narrow", () => {
    expect(masonryColumns(400, 4)).toBe(1);
  });

  it("grows with the container up to the preference", () => {
    expect(masonryColumns(700, 3)).toBe(2);
    expect(masonryColumns(1000, 3)).toBe(3);
    expect(masonryColumns(1300, 3)).toBe(3);
    expect(masonryColumns(1300, 4)).toBe(4);
  });

  it("falls back to three for an unknown preference", () => {
    expect(masonryColumns(1300, 9)).toBe(3);
  });
});
