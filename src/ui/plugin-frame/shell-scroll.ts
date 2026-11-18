/**
 * A frame's ask for the shell to scroll it (useShellScroll). The page then
 * lays out at its full height and the shell sizes the frame to it, so other
 * plugins' parts drawn over the frame scroll with it natively.
 */

import { useEffect } from "react";

let emit: ((on: boolean) => void) | null = null;
let asks = 0;
let current = false;

function update(): void {
  const on = asks > 0;
  if (on === current) return;
  current = on;
  if (on) document.documentElement.dataset.shellScroll = "";
  else delete document.documentElement.dataset.shellScroll;
  emit?.(on);
}

/** frame-boot hands over how to tell the shell. */
export function setShellScrollEmitter(next: (on: boolean) => void): void {
  emit = next;
  if (current) next(true);
}

/** The shell says how tall the box it scrolls in is. */
export function setShellViewport(data: unknown): void {
  const height = (data as { height?: unknown } | null)?.height;
  if (typeof height !== "number" || !Number.isFinite(height)) return;
  document.documentElement.style.setProperty(
    "--shell-viewport-height",
    `${Math.max(0, Math.min(height, 20_000))}px`,
  );
}

export function useFrameShellScroll(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    asks++;
    update();
    return () => {
      asks--;
      update();
    };
  }, [on]);
}

/** Test seam. */
export function resetShellScroll(): void {
  emit = null;
  asks = 0;
  current = false;
  delete document.documentElement.dataset.shellScroll;
}
