import { describe, expect, it } from "vitest";
import { showsInBar } from "@/sidebar/tree/host-bar-actions";

describe("showsInBar", () => {
  it("follows the action's own default without a choice", () => {
    expect(showsInBar({}, { id: "terminal" })).toBe(true);
    expect(showsInBar({}, { id: "maintenance", tray: false })).toBe(false);
  });

  it("lets the user's choice win either way", () => {
    expect(
      showsInBar({ maintenance: true }, { id: "maintenance", tray: false }),
    ).toBe(true);
    expect(showsInBar({ "ai-agent": false }, { id: "ai-agent" })).toBe(false);
  });
});
