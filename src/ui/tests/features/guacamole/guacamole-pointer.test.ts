import { describe, expect, it, vi } from "vitest";
import { bindPointerInput } from "../../../features/guacamole/guacamole-pointer.js";

function listenedEvents(): {
  element: HTMLElement;
  events: () => string[];
} {
  const element = document.createElement("div");
  const seen: string[] = [];
  const original = element.addEventListener.bind(element);
  element.addEventListener = ((type: string, ...rest: unknown[]) => {
    seen.push(type);
    return (original as (t: string, ...r: unknown[]) => void)(type, ...rest);
  }) as typeof element.addEventListener;
  return { element, events: () => seen };
}

describe("bindPointerInput", () => {
  // A touchscreen laptop reports maxTouchPoints > 0 and still has a mouse.
  // Binding only the touch emulator left the pointer dead on those machines.
  it.each([
    ["no touch mode", null],
    ["touchscreen", "touchscreen" as const],
    ["touchpad", "touchpad" as const],
  ])("keeps the physical pointer bound with %s", (_label, touchMode) => {
    const { element, events } = listenedEvents();

    bindPointerInput(element, touchMode, vi.fn());

    expect(events()).toContain("mousedown");
    expect(events()).toContain("mousemove");
    expect(events()).toContain("mouseup");
  });

  it("adds touch listeners only when a touch mode is selected", () => {
    const withoutTouch = listenedEvents();
    bindPointerInput(withoutTouch.element, null, vi.fn());
    const plainTouchCount = withoutTouch
      .events()
      .filter((e) => e.startsWith("touch")).length;

    const withTouch = listenedEvents();
    bindPointerInput(withTouch.element, "touchscreen", vi.fn());
    const touchModeCount = withTouch
      .events()
      .filter((e) => e.startsWith("touch")).length;

    expect(touchModeCount).toBeGreaterThan(plainTouchCount);
  });

  it("does not forward a wheel flood as individual remote scroll clicks", () => {
    vi.useFakeTimers();
    const element = document.createElement("div");
    const onState = vi.fn();
    const dispose = bindPointerInput(element, null, onState);

    for (let i = 0; i < 30; i++) {
      element.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 120,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    const presses = onState.mock.calls.filter(
      ([state]) => state.up === true || state.down === true,
    );
    expect(presses.length).toBeLessThanOrEqual(2);

    vi.advanceTimersByTime(40);
    const laterPresses = onState.mock.calls.filter(
      ([state]) => state.up === true || state.down === true,
    );
    expect(laterPresses.length).toBeLessThanOrEqual(4);

    dispose();
    vi.useRealTimers();
  });
});
