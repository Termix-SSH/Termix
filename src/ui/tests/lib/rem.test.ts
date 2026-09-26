import { afterEach, describe, expect, it } from "vitest";
import { rem, remScale } from "@/lib/rem";

afterEach(() => {
  document.documentElement.style.fontSize = "";
});

describe("rem", () => {
  it("states a Normal-size pixel length in rem", () => {
    expect(rem(14)).toBe("1rem");
    expect(rem(160)).toBe(`${160 / 14}rem`);
  });

  it("reports how much the interface size scales a pixel", () => {
    document.documentElement.style.fontSize = "14px";
    expect(remScale()).toBe(1);
    document.documentElement.style.fontSize = "17.5px";
    expect(remScale()).toBe(1.25);
  });
});
