/**
 * A sandboxed frame has no `window.electronAPI`, so `isElectron()` from the
 * plugin SDK said "not desktop" in every framed plugin and their desktop-only
 * parts (the local terminal, ...) never showed. The shell tells the frame
 * whether it runs in the desktop app; mirror that where `isElectron()` looks.
 */
export function markFrameDesktop(available: boolean | undefined): void {
  if (typeof available !== "boolean") return;
  (window as Window & { IS_ELECTRON?: boolean }).IS_ELECTRON = available;
}
