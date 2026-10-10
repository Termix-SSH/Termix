import { describe, expect, it } from "vitest";
import { usageBarColor, usageColor } from "@/lib/usage-color";

describe("usage color ramp", () => {
  it("uses the brand color below 75", () => {
    expect(usageColor(10)).toBe("text-accent-brand");
    expect(usageBarColor(74.9)).toBe("bg-accent-brand");
  });

  it("warns from 75 and turns destructive from 90", () => {
    expect(usageColor(75)).toBe("text-warning");
    expect(usageBarColor(89)).toBe("bg-warning");
    expect(usageColor(90)).toBe("text-destructive");
    expect(usageBarColor(100)).toBe("bg-destructive");
  });

  it("mutes an unknown value", () => {
    expect(usageColor(null)).toBe("text-muted-foreground");
    expect(usageBarColor(null)).toBe("bg-muted-foreground/30");
  });
});
