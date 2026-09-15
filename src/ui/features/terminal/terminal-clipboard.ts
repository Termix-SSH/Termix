import type { Terminal } from "@xterm/xterm";
import { getCookie } from "@/main-axios.ts";
import { isPhysicalShortcutKey } from "./terminal-key-event";

export function getUseRightClickCopyPaste(): boolean {
  return getCookie("rightClickCopyPaste") !== "false";
}

export interface TerminalClipboardActions {
  writeTextToClipboard: (text: string) => Promise<unknown>;
  readTextFromClipboard: () => Promise<string>;
}

export interface TerminalClipboardKeyOptions {
  /**
   * How a plain Ctrl/Cmd+V with no other modifiers is handled.
   * "native" (default, matches the SSH terminal) leaves the key alone so the
   * browser's own paste event fires - this avoids re-triggering the OS
   * clipboard permission prompt on every keystroke, but requires the caller
   * to also listen for the DOM "paste" event.
   * "explicit" reads the clipboard directly instead, for terminals with no
   * such paste event listener of their own.
   */
  plainPasteMode?: "native" | "explicit";
}

/**
 * Shared copy/paste keyboard shortcuts for xterm-based terminals:
 * Ctrl/Cmd+C copies the current selection (Ctrl+C also clears it, matching
 * its dual use as SIGINT when nothing is selected), Ctrl+Insert copies
 * without clearing, and Ctrl+Shift+C / Ctrl+Shift+V always copy/paste
 * regardless of selection state. Returns false (having called
 * preventDefault/stopPropagation) once it has handled the event, true
 * otherwise so callers can keep processing the keydown.
 */
export function handleTerminalClipboardKeyEvent(
  e: KeyboardEvent,
  terminal: Terminal,
  { writeTextToClipboard, readTextFromClipboard }: TerminalClipboardActions,
  { plainPasteMode = "native" }: TerminalClipboardKeyOptions = {},
): boolean {
  const isCopyKey = isPhysicalShortcutKey(e, "KeyC", "c");
  const isPasteKey = isPhysicalShortcutKey(e, "KeyV", "v");

  if (
    e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    isCopyKey &&
    terminal.hasSelection()
  ) {
    const selection = terminal.getSelection();
    if (selection) {
      e.preventDefault();
      e.stopPropagation();
      writeTextToClipboard(selection);
      terminal.clearSelection();
      return false;
    }
  }

  if (
    (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && isCopyKey) ||
    (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key === "Insert")
  ) {
    const selection = terminal.getSelection();
    if (selection) {
      e.preventDefault();
      e.stopPropagation();
      writeTextToClipboard(selection);
      return false;
    }
  }

  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && isCopyKey) {
    const selection = terminal.getSelection();
    if (selection) {
      e.preventDefault();
      e.stopPropagation();
      writeTextToClipboard(selection);
      terminal.clearSelection();
      return false;
    }
  }

  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && isPasteKey) {
    e.preventDefault();
    e.stopPropagation();
    readTextFromClipboard().then((text) => {
      if (text) terminal.paste(text);
    });
    return false;
  }

  const plainModPaste =
    ((e.ctrlKey && !e.metaKey) || (e.metaKey && !e.ctrlKey)) &&
    !e.shiftKey &&
    !e.altKey &&
    isPasteKey;
  if (plainModPaste) {
    if (plainPasteMode === "explicit") {
      e.preventDefault();
      e.stopPropagation();
      readTextFromClipboard().then((text) => {
        if (text) terminal.paste(text);
      });
    }
    // "native": leave the event alone so the browser's own paste event fires.
    return false;
  }

  return true;
}

export interface TerminalContextMenuOptions {
  /** Optional Ctrl+right-click passthrough, e.g. to open a file manager. */
  onCtrlClick?: () => void;
}

/**
 * Builds a "contextmenu" listener implementing right-click copy/paste:
 * copies the selection if one exists, otherwise pastes. Gated behind the
 * user's "rightClickCopyPaste" preference cookie.
 */
export function createTerminalContextMenuHandler(
  terminal: Terminal,
  { writeTextToClipboard, readTextFromClipboard }: TerminalClipboardActions,
  { onCtrlClick }: TerminalContextMenuOptions = {},
): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    if (e.ctrlKey && onCtrlClick) {
      e.preventDefault();
      e.stopPropagation();
      onCtrlClick();
      return;
    }

    if (!getUseRightClickCopyPaste()) return;

    e.preventDefault();
    e.stopPropagation();
    if (terminal.hasSelection()) {
      const text = terminal.getSelection();
      writeTextToClipboard(text).then(() => terminal.clearSelection());
    } else {
      readTextFromClipboard().then((text) => {
        if (text) terminal.paste(text);
      });
    }
  };
}
