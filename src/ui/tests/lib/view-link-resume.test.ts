import { describe, expect, it } from "vitest";
import { consumeViewLink, toViewLinkPath } from "@/lib/view-link-resume";

describe("toViewLinkPath", () => {
  it.each([
    ["/?view=example-plugin.request&request=123", true],
    ["/termix/?view=example-plugin.request#top", true],
    ["//evil.com/?view=x", false],
    ["/\\evil.com/?view=x", false],
    ["https://evil.com/?view=x", false],
    ["/foo", false],
    ["/?view=", false],
    ["not a url", false],
  ])("%s -> %s", (value, accepted) => {
    expect(toViewLinkPath(value)).toBe(accepted ? value : null);
  });
});

describe("consumeViewLink", () => {
  it("clears the stored link even when it is invalid", () => {
    sessionStorage.setItem("termix-pending-view-link", "//evil.com/?view=x");
    expect(consumeViewLink()).toBeNull();
    expect(sessionStorage.getItem("termix-pending-view-link")).toBeNull();
  });
});
