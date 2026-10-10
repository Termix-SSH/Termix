import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  betaTitle,
  groupCommits,
  renderBody,
} = require("./generate-beta-body.cjs");

describe("generate-beta-body", () => {
  it("groups commits by their prefix", () => {
    expect(
      groupCommits([
        "feat: add beta channel",
        "fix(sync): keep links",
        "chore: bump deps",
        "Plain message",
      ]),
    ).toEqual({
      features: ["add beta channel"],
      fixes: ["keep links"],
      other: ["bump deps", "Plain message"],
    });
  });

  it("names the beta", () => {
    expect(betaTitle("26.11.0-beta.2")).toBe("26.11.0 Beta 2");
  });

  it("links feedback with the version and lists the changes", () => {
    const body = renderBody({
      version: "26.11.0-beta.2",
      branch: "dev-26.11.0",
      sha: "abc",
      prev: "v26.11.0-beta.1",
      subjects: ["feat: one", "fix: two"],
    });
    expect(body).toContain("termix-version=26.11.0-beta.2");
    expect(body).toContain("## Changes in 26.11.0 Beta 2");
    expect(body).toContain("### Features\n\n- one");
    expect(body).toContain("### Fixes\n\n- two");
    expect(body).toContain("compare/v26.11.0-beta.1...abc");
    expect(body).not.toContain("—");
  });

  it("says so when there is nothing to compare against", () => {
    const body = renderBody({
      version: "26.11.0-beta.1",
      branch: "dev-26.11.0",
      sha: "abc",
      prev: "",
      subjects: [],
    });
    expect(body).toContain("First beta of this version.");
  });
});
