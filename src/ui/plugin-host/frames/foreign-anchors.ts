/**
 * Where a frame's foreign layer sits when it is not on the page wide layer:
 * a box next to the frame's iframe, so the browser moves the frame and the
 * parts drawn over it together, with nothing to measure on scroll. Full size
 * tab views get one from the start, so their layer never has to move (moving
 * it would reload every part on it).
 */

const anchors = new Map<HTMLIFrameElement, HTMLElement>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

export function setForeignAnchor(
  iframe: HTMLIFrameElement,
  anchor: HTMLElement | null,
): void {
  if (anchor) {
    if (anchors.get(iframe) === anchor) return;
    anchors.set(iframe, anchor);
  } else {
    if (!anchors.has(iframe)) return;
    anchors.delete(iframe);
  }
  changed();
}

export function foreignAnchorOf(iframe: HTMLIFrameElement): HTMLElement | null {
  return anchors.get(iframe) ?? null;
}

/** The box the shell scrolls the frame in, when it does. */
export function shellScrollBoxOf(
  iframe: HTMLIFrameElement,
): HTMLElement | null {
  const box = anchors.get(iframe)?.parentElement ?? null;
  return box?.dataset.shellScroll !== undefined ? box : null;
}

export function subscribeForeignAnchors(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
