/**
 * A frame sized to its content (a settings field, a card) is too small for
 * an inline view. While one is open the frame asks the shell to grow it over
 * the whole surface it sits in, and its page fills that box.
 */

import type { EditingWidth } from "@/components/surface/surface-scope";

let emit: ((width: EditingWidth) => void) | null = null;
let current: EditingWidth = false;

/** frame-boot hands over how to tell the shell. */
export function setFrameCoverEmitter(next: (width: EditingWidth) => void) {
  emit = next;
  if (current) next(current);
}

export function reportFrameCover(width: EditingWidth): void {
  if (width === current) return;
  current = width;
  if (width) document.documentElement.dataset.frameCover = "";
  else delete document.documentElement.dataset.frameCover;
  emit?.(width);
}

/** Test seam. */
export function resetFrameCover(): void {
  emit = null;
  current = false;
  delete document.documentElement.dataset.frameCover;
}
