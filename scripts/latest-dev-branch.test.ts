import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { latestDevBranch } = require("./latest-dev-branch.cjs");

describe("latestDevBranch", () => {
  it("picks the highest semver dev branch", () => {
    expect(latestDevBranch(["dev-2.3.9", "dev-2.4.0", "dev-1.11.2"])).toBe(
      "dev-2.4.0",
    );
  });

  it("compares numerically, not lexically", () => {
    expect(latestDevBranch(["dev-2.10.0", "dev-2.9.0"])).toBe("dev-2.10.0");
  });

  it("ignores main and non-dev branches", () => {
    expect(latestDevBranch(["main", "feature/x", "dev-1.0.0"])).toBe(
      "dev-1.0.0",
    );
  });

  it("strips refs/heads/ prefixes", () => {
    expect(latestDevBranch(["refs/heads/dev-3.0.1"])).toBe("dev-3.0.1");
  });

  it("throws when there are no dev branches", () => {
    expect(() => latestDevBranch(["main", "feature/x"])).toThrow(
      /no dev-X\.Y\.Z branches/,
    );
  });
});
