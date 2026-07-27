import { describe, expect, it } from "vitest";
import { isTabKeyEvent } from "@/features/terminal/terminal-key-event";

describe("isTabKeyEvent", () => {
  it.each([
    ["key", new KeyboardEvent("keydown", { key: "Tab" })],
    ["code", new KeyboardEvent("keydown", { code: "Tab" })],
    [
      "legacy keyCode",
      new KeyboardEvent("keydown", { keyCode: 9 } as KeyboardEventInit),
    ],
  ])("recognizes Tab from %s", (_source, event) => {
    expect(isTabKeyEvent(event)).toBe(true);
  });

  it("does not treat another key as Tab", () => {
    expect(
      isTabKeyEvent(new KeyboardEvent("keydown", { key: "Enter" })),
    ).toBe(false);
  });
});
