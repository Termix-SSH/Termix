import { describe, expect, it, vi } from "vitest";
import {
  clampPendingScrollClicks,
  createScrollCoalescer,
  isScrollButtonState,
  MAX_SCROLL_CLICKS_PER_FLUSH,
  SCROLL_FLUSH_INTERVAL_MS,
  takeScrollClicks,
} from "../../../features/guacamole/guacamole-scroll.js";

describe("guacamole scroll coalescing", () => {
  it("caps a click flood so a laggy tunnel cannot queue a backlog", () => {
    expect(clampPendingScrollClicks(0, 40)).toBe(MAX_SCROLL_CLICKS_PER_FLUSH);
    expect(clampPendingScrollClicks(0, -40)).toBe(-MAX_SCROLL_CLICKS_PER_FLUSH);
    expect(takeScrollClicks(20)).toEqual({
      clicks: MAX_SCROLL_CLICKS_PER_FLUSH,
      direction: 1,
    });
  });

  it("sends the first notch immediately and drops later clicks in the same burst", () => {
    const send = vi.fn();
    let now = 1_000;
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    const coalescer = createScrollCoalescer(
      send,
      () => now,
      (fn, ms) => {
        scheduled.push({ fn, ms });
        return scheduled.length;
      },
      () => {},
    );

    coalescer.notePointer({
      x: 12,
      y: 34,
      left: false,
      middle: false,
      right: false,
      up: false,
      down: false,
    });
    for (let i = 0; i < 20; i++) coalescer.ingestClick(1);

    const firstBurst = send.mock.calls.map(([state]) => state);
    expect(firstBurst).toEqual([
      {
        x: 12,
        y: 34,
        left: false,
        middle: false,
        right: false,
        up: false,
        down: true,
      },
      {
        x: 12,
        y: 34,
        left: false,
        middle: false,
        right: false,
        up: false,
        down: false,
      },
    ]);

    send.mockClear();
    now += SCROLL_FLUSH_INTERVAL_MS;
    expect(scheduled).toHaveLength(1);
    scheduled[0].fn();
    expect(send.mock.calls).toHaveLength(MAX_SCROLL_CLICKS_PER_FLUSH * 2);
    coalescer.dispose();
  });

  it("recognizes only the scroll buttons as coalesced input", () => {
    expect(isScrollButtonState({ up: true, down: false })).toBe(true);
    expect(isScrollButtonState({ up: false, down: true })).toBe(true);
    expect(isScrollButtonState({ up: false, down: false })).toBe(false);
  });
});
