import { describe, it, expect } from "vitest";
import {
  eventMatchesCombo,
  findMatchingKeybinding,
} from "../../lib/keybinding-match";
import type { CustomKeybinding, KeyCombo } from "../../types/keybindings";

function makeEvent(
  init: Partial<KeyboardEventInit> & { key: string; code?: string },
) {
  return new KeyboardEvent("keydown", {
    key: init.key,
    code: init.code ?? init.key,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
  });
}

const ctrlC: KeyCombo = {
  key: "c",
  isCode: false,
  ctrl: true,
  alt: false,
  shift: false,
  meta: false,
};

describe("eventMatchesCombo", () => {
  it("matches an exact modifier and key combination", () => {
    const e = makeEvent({ key: "c", ctrlKey: true });
    expect(eventMatchesCombo(e, ctrlC)).toBe(true);
  });

  it("does not match when an extra modifier is held", () => {
    const e = makeEvent({ key: "c", ctrlKey: true, shiftKey: true });
    expect(eventMatchesCombo(e, ctrlC)).toBe(false);
  });

  it("does not match when a required modifier is missing", () => {
    const e = makeEvent({ key: "c" });
    expect(eventMatchesCombo(e, ctrlC)).toBe(false);
  });

  it("compares against e.code when isCode is true", () => {
    const combo: KeyCombo = {
      key: "BracketRight",
      isCode: true,
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    };
    const e = makeEvent({ key: "]", code: "BracketRight", ctrlKey: true });
    expect(eventMatchesCombo(e, combo)).toBe(true);
  });

  it("compares against e.key.toLowerCase() when isCode is false", () => {
    const e = makeEvent({ key: "C", ctrlKey: true });
    expect(eventMatchesCombo(e, ctrlC)).toBe(true);
  });
});

describe("findMatchingKeybinding", () => {
  function makeBinding(id: string, combo: KeyCombo): CustomKeybinding {
    return {
      id,
      combo,
      action: { type: "copy" },
      enabled: true,
      createdAt: "",
      updatedAt: "",
    };
  }

  it("returns the first matching binding", () => {
    const bindings = [makeBinding("a", ctrlC), makeBinding("b", ctrlC)];
    const e = makeEvent({ key: "c", ctrlKey: true });
    expect(findMatchingKeybinding(e, bindings)?.id).toBe("a");
  });

  it("returns undefined when no bindings match", () => {
    const bindings = [makeBinding("a", ctrlC)];
    const e = makeEvent({ key: "v", ctrlKey: true });
    expect(findMatchingKeybinding(e, bindings)).toBeUndefined();
  });
});
