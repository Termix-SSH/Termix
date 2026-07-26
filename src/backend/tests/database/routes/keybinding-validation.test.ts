import { describe, it, expect } from "vitest";
import {
  isValidKeyCombo,
  isValidKeybindingAction,
  isValidKeybinding,
} from "../../../database/routes/keybinding-validation.js";

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

  it("rejects an unknown action type", () => {
    expect(isValidKeybindingAction({ type: "explode" })).toBe(false);
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
