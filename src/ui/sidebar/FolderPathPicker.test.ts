import { describe, expect, it } from "vitest";
import { normalizePath, splitPath } from "./FolderPathPicker.js";

describe("splitPath", () => {
  it("splits on canonical separator", () => {
    expect(splitPath("Homelab / Debian")).toEqual(["Homelab", "Debian"]);
  });

  it("splits on slash without spaces", () => {
    expect(splitPath("Homelab/Debian")).toEqual(["Homelab", "Debian"]);
  });

  it("splits on slash with only leading space", () => {
    expect(splitPath("Homelab /Debian")).toEqual(["Homelab", "Debian"]);
  });

  it("splits on slash with only trailing space", () => {
    expect(splitPath("Homelab/ Debian")).toEqual(["Homelab", "Debian"]);
  });

  it("handles three levels", () => {
    expect(splitPath("A/B/C")).toEqual(["A", "B", "C"]);
  });

  it("filters empty segments from leading/trailing slashes", () => {
    expect(splitPath("/Debian/")).toEqual(["Debian"]);
  });

  it("returns single segment for non-slash path", () => {
    expect(splitPath("Homelab")).toEqual(["Homelab"]);
  });
});

describe("normalizePath", () => {
  it("normalizes slash-without-spaces to canonical form", () => {
    expect(normalizePath("Homelab/Debian")).toBe("Homelab / Debian");
  });

  it("is idempotent on already-canonical input", () => {
    expect(normalizePath("Homelab / Debian")).toBe("Homelab / Debian");
  });

  it("normalizes mixed spacing around slash", () => {
    expect(normalizePath("Homelab /Debian/ Servers")).toBe(
      "Homelab / Debian / Servers",
    );
  });

  it("returns empty string for empty input", () => {
    expect(normalizePath("")).toBe("");
  });
});
