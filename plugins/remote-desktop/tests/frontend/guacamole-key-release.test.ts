/// <reference types="vite/client" />
import ts from "typescript";
import Guacamole from "guacamole-common-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import displaySource from "../../src/frontend/GuacamoleDisplay.tsx?raw";

// Exercise the display's actual focus callback with Guacamole's real keyboard.
const source = ts.createSourceFile(
  "GuacamoleDisplay.tsx",
  displaySource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let callback: string | undefined;
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === "refreshKeyboardHandlers" &&
    node.initializer &&
    ts.isCallExpression(node.initializer)
  ) {
    callback = node.initializer.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
if (!callback) throw new Error("Missing refreshKeyboardHandlers callback");
const runRefresh = new Function(
  "state",
  ts.transpileModule(
    `const { keyboardRef, clientRef, displayElementRef, isVisible, windowFocusedRef, hasKeyboardFocusRef } = state;
    (${callback})();`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText,
) as (state: Record<string, unknown>) => void;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("remote keyboard focus loss", () => {
  it.each(["window", "display", "hidden", "tab"])(
    "releases held modifiers when losing %s focus",
    (reason) => {
      const display = document.createElement("div");
      display.tabIndex = 0;
      document.body.append(display);
      display.focus();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      const keyboard = new Guacamole.Keyboard(display) as Guacamole.Keyboard & {
        press(keysym: number): boolean;
        release(keysym: number): void;
        pressed: Record<number, boolean>;
      };
      const sendKeyEvent = vi.fn();
      const state = {
        keyboardRef: { current: keyboard },
        clientRef: { current: { sendKeyEvent } },
        displayElementRef: { current: display },
        isVisible: true,
        windowFocusedRef: { current: true },
        hasKeyboardFocusRef: { current: true },
      };
      const refresh = () => runRefresh(state);
      refresh();
      const keys = [0xffeb, 0xffe3, 0xffe9]; // Windows, Ctrl, Alt
      keys.forEach((key) => keyboard.press(key));
      expect(sendKeyEvent.mock.calls).toEqual(keys.map((key) => [1, key]));

      if (reason === "window") state.windowFocusedRef.current = false;
      if (reason === "tab") state.isVisible = false;
      if (reason === "hidden") {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      }
      if (reason === "display") {
        state.hasKeyboardFocusRef.current = false;
        display.blur();
      }
      refresh();
      expect(sendKeyEvent.mock.calls.slice(3)).toEqual(
        [...keys].sort((a, b) => a - b).map((key) => [0, key]),
      );
      expect(Object.keys(keyboard.pressed)).toEqual([]);
      expect(keyboard.onkeydown).toBeNull();
      expect(keyboard.onkeyup).toBeNull();
      keyboard.press(0x6c);
      keyboard.reset();
      expect(sendKeyEvent).toHaveBeenCalledTimes(6);

      state.isVisible = true;
      state.windowFocusedRef.current = true;
      state.hasKeyboardFocusRef.current = true;
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      display.focus();
      refresh();
      keyboard.press(0x6c);
      keyboard.release(0x6c);
      expect(sendKeyEvent.mock.calls.slice(6)).toEqual([
        [1, 0x6c],
        [0, 0x6c],
      ]);
    },
  );
});
