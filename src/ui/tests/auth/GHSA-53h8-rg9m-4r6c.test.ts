import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { desktopParentTarget } from "@/lib/embedded-frame";

const own = "https://termix.example.com";

describe("GHSA-53h8-rg9m-4r6c desktop login frame token target", () => {
  it.each([
    [["app://termix"], "app://termix"],
    [["file://"], "*"],
    [["http://localhost:5173"], "http://localhost:5173"],
    [["http://127.0.0.1:30001"], "http://127.0.0.1:30001"],
    [[own], own],
  ])("hands the token to the desktop app parent %j", (ancestors, target) => {
    expect(desktopParentTarget(ancestors, own)).toBe(target);
  });

  it.each([
    [["https://evil.example"]],
    [["https://evil.example", "file://"]],
    [["null"]],
    [["app://evil"]],
    [["https://evil.example", "app://termix"]],
    [["http://localhost.evil.example"]],
    [["https://localhost:5173"]],
    [[]],
  ])("refuses parent chain %j", (ancestors) => {
    expect(desktopParentTarget(ancestors, own)).toBeNull();
  });

  it("refuses when the parent is unknown", () => {
    expect(desktopParentTarget(undefined, own)).toBeNull();
  });

  it("never posts to every origin from the login page", () => {
    const source = fs.readFileSync("src/ui/auth/Auth.tsx", "utf8");
    expect(source).not.toMatch(/postMessage\([\s\S]{0,400}?,\s*"\*",?\s*\)/);
    expect(source.match(/desktopParentTarget\(\)/g)?.length).toBe(3);
  });
});
