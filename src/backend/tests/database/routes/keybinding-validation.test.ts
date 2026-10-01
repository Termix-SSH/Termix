import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  isValidKeyCombo,
  isValidKeybindingAction,
  isValidKeybinding,
  setKeybindingActionSource,
} from "../../../database/routes/keybinding-validation.js";

// What installed plugins declare in contributes.keybindingActions.
beforeEach(() => {
  setKeybindingActionSource(() => [
    { pluginId: "terminal-fixture", id: "copy" },
    { pluginId: "terminal-fixture", id: "paste" },
    {
      pluginId: "terminal-fixture",
      id: "sendControlCode",
      params: {
        controlCode: { type: "string", required: true, pattern: "^[a-zA-Z]$" },
      },
    },
    {
      pluginId: "terminal-fixture",
      id: "sendText",
      params: {
        text: { type: "string", required: true },
        appendEnter: { type: "boolean" },
      },
    },
    {
      pluginId: "commands-fixture",
      id: "runSnippet",
      params: {
        snippetId: { type: "string", required: true, pattern: "^[0-9]+$" },
        appendEnter: { type: "boolean" },
      },
    },
  ]);
});

afterEach(() => setKeybindingActionSource(() => []));

const validCombo = {
  key: "c",
  isCode: false,
  ctrl: true,
  alt: false,
  shift: false,
  meta: false,
};

describe("isValidKeyCombo", () => {
  it("accepts a well-formed combo", () => {
    expect(isValidKeyCombo(validCombo)).toBe(true);
  });

  it("rejects a combo missing a boolean field", () => {
    const { ctrl: _ctrl, ...rest } = validCombo;
    expect(isValidKeyCombo(rest)).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isValidKeyCombo("ctrl+c")).toBe(false);
    expect(isValidKeyCombo(null)).toBe(false);
  });
});

describe("isValidKeybindingAction", () => {
  it("accepts copy and paste with no extra fields", () => {
    expect(isValidKeybindingAction({ type: "copy" })).toBe(true);
    expect(isValidKeybindingAction({ type: "paste" })).toBe(true);
  });

  it.each(["nextTab", "previousTab", "openCommandPalette", "reconnectSession"])(
    "accepts the global %s action",
    (type) => {
      expect(isValidKeybindingAction({ type })).toBe(true);
    },
  );

  it("keeps a type no installed plugin declares, if it looks sane", () => {
    expect(isValidKeybindingAction({ type: "gone.action", arg: "x" })).toBe(
      true,
    );
    expect(isValidKeybindingAction({ type: "gone", nested: { a: 1 } })).toBe(
      false,
    );
    expect(isValidKeybindingAction({ type: "bad type!" })).toBe(false);
    expect(isValidKeybindingAction({ type: 5 })).toBe(false);
  });

  it("refuses a parameter the declaration does not list", () => {
    expect(isValidKeybindingAction({ type: "copy", text: "x" })).toBe(false);
  });

  it("requires text for sendText", () => {
    expect(isValidKeybindingAction({ type: "sendText" })).toBe(false);
    expect(isValidKeybindingAction({ type: "sendText", text: "ls -la" })).toBe(
      true,
    );
  });

  it("requires a single-letter controlCode for sendControlCode", () => {
    expect(
      isValidKeybindingAction({ type: "sendControlCode", controlCode: "w" }),
    ).toBe(true);
    expect(
      isValidKeybindingAction({ type: "sendControlCode", controlCode: "ww" }),
    ).toBe(false);
    expect(
      isValidKeybindingAction({ type: "sendControlCode", controlCode: "1" }),
    ).toBe(false);
    expect(isValidKeybindingAction({ type: "sendControlCode" })).toBe(false);
  });

  it("requires snippetId for runSnippet", () => {
    expect(
      isValidKeybindingAction({ type: "runSnippet", snippetId: "42" }),
    ).toBe(true);
    expect(isValidKeybindingAction({ type: "runSnippet" })).toBe(false);
    expect(
      isValidKeybindingAction({ type: "runSnippet", snippetId: "abc" }),
    ).toBe(false);
  });
});

describe("isValidKeybinding", () => {
  const base = {
    id: "kb-1",
    enabled: true,
    combo: validCombo,
    action: { type: "copy" },
  };

  it("accepts a well-formed keybinding", () => {
    expect(isValidKeybinding(base)).toBe(true);
  });

  it("rejects a keybinding missing id", () => {
    const { id: _id, ...rest } = base;
    expect(isValidKeybinding(rest)).toBe(false);
  });

  it("rejects a keybinding missing enabled", () => {
    const { enabled: _enabled, ...rest } = base;
    expect(isValidKeybinding(rest)).toBe(false);
  });

  it("rejects a keybinding with an invalid combo", () => {
    expect(isValidKeybinding({ ...base, combo: {} })).toBe(false);
  });

  it("rejects a keybinding with an invalid action", () => {
    expect(isValidKeybinding({ ...base, action: { type: "sendText" } })).toBe(
      false,
    );
  });
});
