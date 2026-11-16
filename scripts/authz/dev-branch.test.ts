import { describe, expect, it } from "vitest";
import { newestDevBranch } from "./lib/dev-branch.mjs";

describe("newestDevBranch", () => {
  it("picks the highest dev version", () => {
    const out = [
      "a\trefs/heads/dev-1.0.9",
      "b\trefs/heads/dev-1.1.0",
      "c\trefs/heads/dev-1.10.0-beta.1",
      "d\trefs/heads/dev-1.2.0",
      "e\trefs/heads/dev-notes",
    ].join("\n");
    expect(newestDevBranch(out)).toBe("dev-1.10.0-beta.1");
  });

  it("gives null when there is no dev branch", () => {
    expect(newestDevBranch("a\trefs/heads/main\n")).toBeNull();
    expect(newestDevBranch("")).toBeNull();
  });
});
