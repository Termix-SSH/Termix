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
});
