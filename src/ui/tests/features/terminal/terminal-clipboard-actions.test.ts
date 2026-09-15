import { describe, expect, it } from "vitest";
import {
  resolveTerminalContextMenuAction,
  selectedTextToCopy,
} from "@/features/terminal/terminal-clipboard-actions";

describe("terminal clipboard actions", () => {
  it("copies a completed left-button selection when enabled", () => {
    expect(
      selectedTextToCopy({
        copyOnSelect: true,
        button: 0,
        selection: "selected output",
      }),
    ).toBe("selected output");
    expect(
      selectedTextToCopy({ copyOnSelect: false, button: 0, selection: "x" }),
    ).toBeNull();
  });

  it("pastes on right-click after copy-on-select", () => {
    expect(
      resolveTerminalContextMenuAction({
        rightClickCopyPaste: true,
        copyOnSelect: true,
        hasSelection: true,
      }),
    ).toBe("paste");
  });

  it("preserves existing right-click and native-menu behavior", () => {
    expect(
      resolveTerminalContextMenuAction({
        rightClickCopyPaste: true,
        copyOnSelect: false,
        hasSelection: true,
      }),
    ).toBe("copy");
    expect(
      resolveTerminalContextMenuAction({
        rightClickCopyPaste: false,
        copyOnSelect: true,
        hasSelection: true,
      }),
    ).toBe("native");
  });
});
