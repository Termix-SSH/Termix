export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function isTabJumpHotkey(e: KeyboardEvent): boolean {
  if (!/^Digit[1-9]$/.test(e.code)) return false;
  if (isMacPlatform()) {
    return e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey;
  }
  return e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey;
}

export function getTabJumpDigit(e: KeyboardEvent): number | null {
  const match = /^Digit([1-9])$/.exec(e.code);
  if (!match || !isTabJumpHotkey(e)) return null;
  return Number(match[1]);
}

export function tabJumpHotkeyKeys(): string[] {
  return isMacPlatform() ? ["Cmd", "1-9"] : ["Alt", "1-9"];
}
