/**
 * guacamole-common-js turns each wheel tick into one or more mouse-button
 * clicks (button 4/5). High-resolution trackpads and the library's duplicate
 * wheel/mousewheel listeners can emit dozens of those clicks in a single
 * gesture. Each click is two Guacamole instructions, so a laggy path (a
 * Cloudflare-proxied remote session especially) queues them and the remote
 * desktop keeps scrolling long after the user stopped.
 *
 * Cap the in-flight click count and space flushes out so scrolling stays
 * usable without changing the websocket proxy.
 */
export const MAX_SCROLL_CLICKS_PER_FLUSH = 2;
export const SCROLL_FLUSH_INTERVAL_MS = 32;

export type ScrollClickDirection = 1 | -1;

export interface GuacamolePointerState {
  x: number;
  y: number;
  left: boolean;
  middle: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export function clampPendingScrollClicks(
  pending: number,
  delta: number,
  max = MAX_SCROLL_CLICKS_PER_FLUSH,
): number {
  return Math.max(-max, Math.min(max, pending + delta));
}

export function takeScrollClicks(pending: number): {
  clicks: number;
  direction: ScrollClickDirection | 0;
} {
  if (pending === 0) return { clicks: 0, direction: 0 };
  const direction: ScrollClickDirection = pending < 0 ? -1 : 1;
  return {
    clicks: Math.min(MAX_SCROLL_CLICKS_PER_FLUSH, Math.abs(pending)),
    direction,
  };
}

function mouseState(
  x: number,
  y: number,
  buttons: Pick<GuacamolePointerState, "left" | "middle" | "right">,
  up: boolean,
  down: boolean,
): GuacamolePointerState {
  return {
    x,
    y,
    left: buttons.left,
    middle: buttons.middle,
    right: buttons.right,
    up,
    down,
  };
}

export function createScrollCoalescer(
  send: (state: GuacamolePointerState) => void,
  now: () => number = () => Date.now(),
  schedule: (fn: () => void, ms: number) => number = (fn, ms) =>
    window.setTimeout(fn, ms),
  cancel: (id: number) => void = (id) => window.clearTimeout(id),
): {
  notePointer: (state: GuacamolePointerState) => void;
  ingestClick: (direction: ScrollClickDirection) => void;
  dispose: () => void;
} {
  let pending = 0;
  let timer: number | null = null;
  let x = 0;
  let y = 0;
  let buttons = { left: false, middle: false, right: false };
  let lastFlushAt = 0;

  const flush = () => {
    timer = null;
    const { clicks, direction } = takeScrollClicks(pending);
    pending = 0;
    if (clicks === 0 || direction === 0) return;
    lastFlushAt = now();
    const up = direction < 0;
    const down = direction > 0;
    for (let i = 0; i < clicks; i++) {
      send(mouseState(x, y, buttons, up, down));
      send(mouseState(x, y, buttons, false, false));
    }
  };

  return {
    notePointer(state) {
      x = state.x;
      y = state.y;
      buttons = {
        left: state.left,
        middle: state.middle,
        right: state.right,
      };
    },
    ingestClick(direction) {
      pending = clampPendingScrollClicks(pending, direction);
      const elapsed = now() - lastFlushAt;
      if (elapsed >= SCROLL_FLUSH_INTERVAL_MS) {
        flush();
        return;
      }
      if (timer == null) {
        timer = schedule(flush, SCROLL_FLUSH_INTERVAL_MS - elapsed);
      }
    },
    dispose() {
      if (timer == null) return;
      cancel(timer);
      timer = null;
    },
  };
}

export function isScrollButtonState(state: {
  up?: boolean;
  down?: boolean;
}): boolean {
  return state.up === true || state.down === true;
}
