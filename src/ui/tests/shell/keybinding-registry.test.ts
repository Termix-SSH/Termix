import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GLOBAL_KEYBINDING_EVENT,
  SHELL_KEYBINDING_ACTION_IDS,
  getKeybindingAction,
  listKeybindingActions,
  registerKeybindingAction,
  resetKeybindingRegistry,
  runKeybindingAction,
} from "../../shell/keybinding-registry";

afterEach(() => resetKeybindingRegistry());

describe("keybinding registry", () => {
  it("starts with the shell's own actions, all global", () => {
    expect(listKeybindingActions().map((action) => action.id)).toEqual(
      SHELL_KEYBINDING_ACTION_IDS,
    );
    expect(getKeybindingAction("nextTab")?.scope).toBe("global");
  });

  it("runs a shell action by telling the shell", () => {
    const listener = vi.fn();
    window.addEventListener(GLOBAL_KEYBINDING_EVENT, listener);
    try {
      expect(runKeybindingAction({ type: "openCommandPalette" })).toBe(true);
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
        type: "openCommandPalette",
      });
    } finally {
      window.removeEventListener(GLOBAL_KEYBINDING_EVENT, listener);
    }
  });

  it("runs a plugin's action with the caller's context, until it is disposed", () => {
    const run = vi.fn();
    const dispose = registerKeybindingAction({
      id: "sample.run",
      pluginId: "sample",
      labelKey: "sample:run",
      scope: "session",
      run,
    });
    const send = vi.fn();
    expect(runKeybindingAction({ type: "sample.run", x: "1" }, { send })).toBe(
      true,
    );
    expect(run).toHaveBeenCalledWith({ type: "sample.run", x: "1" }, { send });
    dispose();
    expect(runKeybindingAction({ type: "sample.run" })).toBe(false);
  });

  it("answers false for a type nothing running handles", () => {
    expect(runKeybindingAction({ type: "gone" })).toBe(false);
  });

  it("refuses a shell id and a second plugin claiming a type", () => {
    expect(() =>
      registerKeybindingAction({
        id: "nextTab",
        pluginId: "sample",
        labelKey: "x",
        scope: "global",
      }),
    ).toThrow(/belongs to the shell/);
    registerKeybindingAction({
      id: "sample.run",
      pluginId: "sample",
      labelKey: "x",
      scope: "session",
    });
    expect(() =>
      registerKeybindingAction({
        id: "sample.run",
        pluginId: "other",
        labelKey: "x",
        scope: "session",
      }),
    ).toThrow(/already registered/);
  });
});
