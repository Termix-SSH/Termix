import { describe, expect, it } from "vitest";
import {
  isPhysicalShortcutKey,
  isTabKeyEvent,
} from "@/features/terminal/terminal-key-event";

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
    expect(isTabKeyEvent(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(
      false,
    );
  });
});

describe("isPhysicalShortcutKey", () => {
  it("matches copy and paste by physical code under a Cyrillic layout", () => {
    expect(isPhysicalShortcutKey({ key: "с", code: "KeyC" }, "KeyC", "c")).toBe(
      true,
    );
    expect(isPhysicalShortcutKey({ key: "м", code: "KeyV" }, "KeyV", "v")).toBe(
      true,
    );
  });

  it("does not confuse another physical key with a translated character", () => {
    expect(isPhysicalShortcutKey({ key: "c", code: "KeyV" }, "KeyC", "c")).toBe(
      false,
    );
  });

  it("falls back to key when code is unavailable", () => {
    expect(isPhysicalShortcutKey({ key: "C", code: "" }, "KeyC", "c")).toBe(
      true,
    );
  });
});
