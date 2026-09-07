import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";

const getCookieMock = vi.fn<(name: string) => string | undefined>();

vi.mock("@/main-axios.ts", () => ({
  getCookie: (name: string) => getCookieMock(name),
}));

import {
  getUseRightClickCopyPaste,
  handleTerminalClipboardKeyEvent,
  createTerminalContextMenuHandler,
} from "@/features/terminal/terminal-clipboard";

function createFakeTerminal({ selection = "" }: { selection?: string } = {}) {
  return {
    hasSelection: vi.fn(() => selection.length > 0),
    getSelection: vi.fn(() => selection),
    clearSelection: vi.fn(),
    paste: vi.fn(),
  };
}

function createActions() {
  return {
    writeTextToClipboard: vi.fn().mockResolvedValue(true),
    readTextFromClipboard: vi.fn().mockResolvedValue("clipboard-text"),
  };
}

function createKeyEvent(init: {
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  key?: string;
  code?: string;
}) {
  return {
    type: "keydown",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    key: "",
    code: "",
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent;
}

function createMouseEvent(init: { ctrlKey?: boolean } = {}) {
  return {
    ctrlKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...init,
  } as unknown as MouseEvent;
}

beforeEach(() => {
  getCookieMock.mockReset();
  getCookieMock.mockReturnValue(undefined);
});

describe("getUseRightClickCopyPaste", () => {
  it("defaults to enabled when the cookie is unset", () => {
    getCookieMock.mockReturnValue(undefined);
    expect(getUseRightClickCopyPaste()).toBe(true);
  });

  it('is disabled only when the cookie is explicitly "false"', () => {
    getCookieMock.mockReturnValue("false");
    expect(getUseRightClickCopyPaste()).toBe(false);

    getCookieMock.mockReturnValue("true");
    expect(getUseRightClickCopyPaste()).toBe(true);
  });
});

describe("handleTerminalClipboardKeyEvent", () => {
  it("copies the selection on Ctrl+C and clears it", () => {
    const terminal = createFakeTerminal({ selection: "hello" });
    const actions = createActions();
    const e = createKeyEvent({ ctrlKey: true, code: "KeyC", key: "c" });

    const handled = handleTerminalClipboardKeyEvent(
      e,
      terminal as unknown as Terminal,
      actions,
    );

    expect(handled).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(actions.writeTextToClipboard).toHaveBeenCalledWith("hello");
    expect(terminal.clearSelection).toHaveBeenCalled();
  });

  it("leaves Ctrl+C alone (SIGINT) when there is no selection", () => {
    const terminal = createFakeTerminal({ selection: "" });
    const actions = createActions();
    const e = createKeyEvent({ ctrlKey: true, code: "KeyC", key: "c" });

    const handled = handleTerminalClipboardKeyEvent(
      e,
      terminal as unknown as Terminal,
      actions,
    );

    expect(handled).toBe(true);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(actions.writeTextToClipboard).not.toHaveBeenCalled();
  });

  it("copies via Ctrl+Insert without clearing the selection", () => {
    const terminal = createFakeTerminal({ selection: "hello" });
    const actions = createActions();
    const e = createKeyEvent({ ctrlKey: true, key: "Insert" });

    const handled = handleTerminalClipboardKeyEvent(
      e,
      terminal as unknown as Terminal,
      actions,
    );

    expect(handled).toBe(false);
    expect(actions.writeTextToClipboard).toHaveBeenCalledWith("hello");
    expect(terminal.clearSelection).not.toHaveBeenCalled();
  });

  it("copies and clears the selection on Ctrl+Shift+C", () => {
    const terminal = createFakeTerminal({ selection: "hello" });
    const actions = createActions();
    const e = createKeyEvent({
      ctrlKey: true,
      shiftKey: true,
      code: "KeyC",
      key: "C",
    });

    const handled = handleTerminalClipboardKeyEvent(
      e,
      terminal as unknown as Terminal,
      actions,
    );

    expect(handled).toBe(false);
    expect(actions.writeTextToClipboard).toHaveBeenCalledWith("hello");
    expect(terminal.clearSelection).toHaveBeenCalled();
  });

  it("is a no-op for Ctrl+Shift+C without a selection", () => {
    const terminal = createFakeTerminal({ selection: "" });
    const actions = createActions();
    const e = createKeyEvent({
      ctrlKey: true,
      shiftKey: true,
      code: "KeyC",
      key: "C",
    });

    const handled = handleTerminalClipboardKeyEvent(
      e,
      terminal as unknown as Terminal,
      actions,
    );

    expect(handled).toBe(true);
    expect(actions.writeTextToClipboard).not.toHaveBeenCalled();
  });

  it("always pastes on Ctrl+Shift+V regardless of selection", async () => {
    const terminal = createFakeTerminal({ selection: "irrelevant" });
    const actions = createActions();
    const e = createKeyEvent({
      ctrlKey: true,
      shiftKey: true,
      code: "KeyV",
      key: "V",
    });

    const handled = handleTerminalClipboardKeyEvent(
      e,
      terminal as unknown as Terminal,
      actions,
    );
    await Promise.resolve();

    expect(handled).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(actions.readTextFromClipboard).toHaveBeenCalled();
    expect(terminal.paste).toHaveBeenCalledWith("clipboard-text");
  });

  it("leaves plain Ctrl+V to the browser's native paste event by default", () => {
    const terminal = createFakeTerminal();
    const actions = createActions();
    const e = createKeyEvent({ ctrlKey: true, code: "KeyV", key: "v" });

    const handled = handleTerminalClipboardKeyEvent(
      e,
      terminal as unknown as Terminal,
      actions,
    );

    expect(handled).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(actions.readTextFromClipboard).not.toHaveBeenCalled();
  });

  it("reads the clipboard explicitly for plain Ctrl+V when configured", async () => {
    const terminal = createFakeTerminal();
    const actions = createActions();
    const e = createKeyEvent({ ctrlKey: true, code: "KeyV", key: "v" });

    const handled = handleTerminalClipboardKeyEvent(
      e,
      terminal as unknown as Terminal,
      actions,
      { plainPasteMode: "explicit" },
    );
    await Promise.resolve();

    expect(handled).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(actions.readTextFromClipboard).toHaveBeenCalled();
    expect(terminal.paste).toHaveBeenCalledWith("clipboard-text");
  });

  it("ignores keys with no clipboard shortcut", () => {
    const terminal = createFakeTerminal();
    const actions = createActions();
    const e = createKeyEvent({ key: "a", code: "KeyA" });

    const handled = handleTerminalClipboardKeyEvent(
      e,
      terminal as unknown as Terminal,
      actions,
    );

    expect(handled).toBe(true);
    expect(actions.writeTextToClipboard).not.toHaveBeenCalled();
    expect(actions.readTextFromClipboard).not.toHaveBeenCalled();
  });
});

describe("createTerminalContextMenuHandler", () => {
  it("routes Ctrl+right-click to the passthrough callback instead of the clipboard", () => {
    const terminal = createFakeTerminal({ selection: "hello" });
    const actions = createActions();
    const onCtrlClick = vi.fn();
    const handler = createTerminalContextMenuHandler(
      terminal as unknown as Terminal,
      actions,
      { onCtrlClick },
    );
    const e = createMouseEvent({ ctrlKey: true });

    handler(e);

    expect(onCtrlClick).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(actions.writeTextToClipboard).not.toHaveBeenCalled();
  });

  it("falls back to normal right-click behavior when Ctrl is held with no passthrough configured", () => {
    const terminal = createFakeTerminal({ selection: "hello" });
    const actions = createActions();
    const handler = createTerminalContextMenuHandler(
      terminal as unknown as Terminal,
      actions,
    );
    const e = createMouseEvent({ ctrlKey: true });

    handler(e);

    expect(actions.writeTextToClipboard).toHaveBeenCalledWith("hello");
  });

  it("does nothing when the right-click preference is disabled", () => {
    getCookieMock.mockReturnValue("false");
    const terminal = createFakeTerminal({ selection: "hello" });
    const actions = createActions();
    const handler = createTerminalContextMenuHandler(
      terminal as unknown as Terminal,
      actions,
    );
    const e = createMouseEvent();

    handler(e);

    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(actions.writeTextToClipboard).not.toHaveBeenCalled();
  });

  it("copies the current selection when right-click copy/paste is enabled", async () => {
    const terminal = createFakeTerminal({ selection: "hello" });
    const actions = createActions();
    const handler = createTerminalContextMenuHandler(
      terminal as unknown as Terminal,
      actions,
    );
    const e = createMouseEvent();

    handler(e);
    await Promise.resolve();

    expect(e.preventDefault).toHaveBeenCalled();
    expect(actions.writeTextToClipboard).toHaveBeenCalledWith("hello");
    expect(terminal.clearSelection).toHaveBeenCalled();
  });

  it("pastes when there is no selection", async () => {
    const terminal = createFakeTerminal({ selection: "" });
    const actions = createActions();
    const handler = createTerminalContextMenuHandler(
      terminal as unknown as Terminal,
      actions,
    );
    const e = createMouseEvent();

    handler(e);
    await Promise.resolve();

    expect(actions.readTextFromClipboard).toHaveBeenCalled();
    expect(terminal.paste).toHaveBeenCalledWith("clipboard-text");
  });
});
