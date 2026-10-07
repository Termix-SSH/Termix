import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { latestBetaTag, nextBeta } = require("./beta-version.cjs");

const TAGS = [
  "v26.10.0",
  "v26.11.0-beta.1",
  "v26.11.0-beta.10",
  "v26.11.0-beta.2",
  "v26.11.0-beta.x",
  "v26.12.0-beta.4",
];

describe("beta-version", () => {
  it("numbers the next beta after the highest one, not the last listed", () => {
    expect(nextBeta("26.11.0", TAGS)).toBe("26.11.0-beta.11");
    expect(latestBetaTag("26.11.0", TAGS)).toBe("v26.11.0-beta.10");
  });

  it("starts at 1 for a version with no betas", () => {
    expect(nextBeta("27.1.0", TAGS)).toBe("27.1.0-beta.1");
    expect(latestBetaTag("27.1.0", TAGS)).toBe("");
  });
});
