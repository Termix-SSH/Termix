import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { parseDevBranch } = require("./parse-dev-branch.cjs");

describe("parseDevBranch", () => {
  it("extracts the version from a dev branch name", () => {
    expect(parseDevBranch("dev-2.4.0")).toBe("2.4.0");
  });

  it("strips a refs/heads/ prefix", () => {
    expect(parseDevBranch("refs/heads/dev-1.11.2")).toBe("1.11.2");
  });

  it("rejects the main branch", () => {
    expect(() => parseDevBranch("main")).toThrow(/dev branch/);
  });

  it("rejects a dev branch without a semver version", () => {
    expect(() => parseDevBranch("dev-foo")).toThrow(/valid semver/);
  });

  it("rejects a partial version", () => {
    expect(() => parseDevBranch("dev-2.4")).toThrow(/valid semver/);
  });

  it("rejects an empty ref", () => {
    expect(() => parseDevBranch("")).toThrow();
  });
});
