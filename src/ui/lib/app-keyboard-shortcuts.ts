export function isShiftKey(event: Pick<KeyboardEvent, "key" | "code">) {
  return (
    event.key === "Shift" ||
    event.code === "ShiftLeft" ||
    event.code === "ShiftRight"
  );
}

export function getAltDigitShortcut(
  event: Pick<KeyboardEvent, "key" | "code">,
) {
  const match = /^Digit([1-9])$/.exec(event.code);
  return match && event.key === match[1] ? Number(match[1]) : null;
}

/** Ctrl+W alone, which closes the tab in the desktop app on Windows and Linux. */
export function isCloseTabKey(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
  >,
) {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    event.key.toLowerCase() === "w"
  );
}

/** Match two consecutive Shift presses, never a typing or IME sequence. */
export function createCommandPaletteShortcutMatcher() {
  let lastShift: number | null = null;
  const reset = () => {
    lastShift = null;
  };
  const matches = (event: KeyboardEvent, now = Date.now()): boolean => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat ||
      event.altKey
    ) {
      reset();
      return false;
    }
    if (isShiftKey(event) && !event.ctrlKey && !event.metaKey) {
      const matched = lastShift !== null && now - lastShift < 300;
      lastShift = matched ? null : now;
      return matched;
    }
    reset();
    return (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      event.code === "KeyK"
    );
  };
  return { matches, reset };
}
