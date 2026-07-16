import { describe, it, expect } from "vitest";
import { toFixedNum, kibToGiB } from "./common-utils.js";

describe("toFixedNum", () => {
  it("rounds to the requested digit count", () => {
    expect(toFixedNum(3.14159, 2)).toBe(3.14);
    expect(toFixedNum(3.14159, 0)).toBe(3);
    expect(toFixedNum(2.5, 0)).toBe(3);
  });

  it("defaults to 2 digits", () => {
    expect(toFixedNum(1.23456)).toBe(1.23);
  });

  it("returns null for non-finite or non-number input", () => {
    expect(toFixedNum(null)).toBeNull();
    expect(toFixedNum(undefined)).toBeNull();
    expect(toFixedNum(NaN)).toBeNull();
    expect(toFixedNum(Infinity)).toBeNull();
  });
});

describe("kibToGiB", () => {
  it("converts kibibytes to gibibytes", () => {
    expect(kibToGiB(1024 * 1024)).toBe(1);
    expect(kibToGiB(0)).toBe(0);
    expect(kibToGiB(2 * 1024 * 1024)).toBe(2);
  });
});
