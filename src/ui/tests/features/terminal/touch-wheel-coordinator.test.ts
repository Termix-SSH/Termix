import { describe, expect, it, vi } from "vitest";
import {
  installTouchWheelCoordinator,
  TouchWheelCoordinator,
} from "../../../features/terminal/touch-wheel-coordinator";

const point = (clientY: number, clientX = 10) => ({ clientX, clientY });

const touchEvent = (type: string, clientYValues: number[]) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = clientYValues.map((clientY) => ({ clientX: 10, clientY }));
  Object.defineProperty(event, "touches", {
    value: Object.assign(touches, {
      item: (index: number) => touches[index] ?? null,
    }),
  });
  return event;
};

const createTiming = (momentumAllowed = true) => {
  let now = 0;
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    timing: {
      now: () => now,
      requestFrame: (callback: FrameRequestCallback) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle: number) => callbacks.delete(handle),
      momentumAllowed: () => momentumAllowed,
    },
    advance(milliseconds: number) {
      now += milliseconds;
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(now));
    },
    pendingFrames: () => callbacks.size,
  };
};

describe("TouchWheelCoordinator", () => {
  it("accumulates the drag threshold and preserves delta direction", () => {
    const emit = vi.fn();
    const coordinator = new TouchWheelCoordinator(emit);

    coordinator.start(point(100));
    expect(coordinator.move(point(97.5))).toBe(true);
    expect(coordinator.move(point(93))).toBe(true);
    coordinator.move(point(101));

    expect(emit.mock.calls.map(([event]) => event.deltaY)).toEqual([7, -8]);
  });

  it("keeps movement below the tap threshold from scrolling", () => {
    const emit = vi.fn();
    const coordinator = new TouchWheelCoordinator(emit);

    coordinator.start(point(100));
    expect(coordinator.move(point(95))).toBe(true);
    coordinator.end();

    expect(emit).not.toHaveBeenCalled();
  });

  it("cancels the gesture when more than one touch is represented", () => {
    const emit = vi.fn();
    const coordinator = new TouchWheelCoordinator(emit);

    coordinator.start(point(100));
    coordinator.move(undefined);
    expect(coordinator.move(point(80))).toBe(false);

    expect(emit).not.toHaveBeenCalled();
  });

  it("cleans up cancelled state before the next gesture", () => {
    const emit = vi.fn();
    const coordinator = new TouchWheelCoordinator(emit);

    coordinator.start(point(100));
    coordinator.cancel();
    coordinator.start(point(50));
    expect(coordinator.move(point(43.5))).toBe(true);

    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0][0].deltaY).toBe(6.5);
  });

  it.each([
    { start: 100, end: 20, direction: 1 },
    { start: 20, end: 100, direction: -1 },
  ])(
    "emits multiple $direction line ticks after release",
    ({ start, end, direction }) => {
      const emit = vi.fn();
      const clock = createTiming();
      const coordinator = new TouchWheelCoordinator(
        emit,
        undefined,
        undefined,
        clock.timing,
      );

      coordinator.start(point(start));
      clock.advance(20);
      coordinator.move(point((start + end) / 2));
      clock.advance(20);
      coordinator.move(point(end));
      coordinator.end();
      const dragCallCount = emit.mock.calls.length;

      for (let index = 0; index < 12; index++) clock.advance(16);
      const momentum = emit.mock.calls
        .slice(dragCallCount)
        .map(([event]) => event);

      expect(momentum.length).toBeGreaterThan(3);
      expect(
        momentum.every(
          (event) =>
            event.deltaMode === WheelEvent.DOM_DELTA_LINE &&
            event.deltaY === direction,
        ),
      ).toBe(true);
    },
  );

  it("decays the number of line ticks emitted over time", () => {
    const emit = vi.fn();
    const clock = createTiming();
    const coordinator = new TouchWheelCoordinator(
      emit,
      undefined,
      undefined,
      clock.timing,
    );
    coordinator.start(point(200));
    clock.advance(20);
    coordinator.move(point(100));
    coordinator.end();
    const dragCalls = emit.mock.calls.length;

    const frameCounts: number[] = [];
    for (let index = 0; index < 24; index++) {
      const before = emit.mock.calls.length;
      clock.advance(16);
      frameCounts.push(emit.mock.calls.length - before);
    }

    expect(emit.mock.calls.length - dragCalls).toBeGreaterThan(3);
    expect(frameCounts.slice(0, 8).reduce((a, b) => a + b, 0)).toBeGreaterThan(
      frameCounts.slice(-8).reduce((a, b) => a + b, 0),
    );
  });

  it("uses the recent movement window despite a short touchend delay", () => {
    const emit = vi.fn();
    const clock = createTiming();
    const coordinator = new TouchWheelCoordinator(
      emit,
      undefined,
      undefined,
      clock.timing,
    );
    coordinator.start(point(100));
    clock.advance(20);
    coordinator.move(point(50));
    clock.advance(80);
    coordinator.end();

    expect(clock.pendingFrames()).toBe(1);
  });

  it("bounds momentum velocity, duration, and total travel", () => {
    const emit = vi.fn();
    const clock = createTiming();
    const coordinator = new TouchWheelCoordinator(
      emit,
      undefined,
      undefined,
      clock.timing,
    );

    coordinator.start(point(1000));
    clock.advance(1);
    coordinator.move(point(0));
    coordinator.end();
    const dragCallCount = emit.mock.calls.length;
    clock.advance(200);
    const firstFrameTicks = emit.mock.calls.length - dragCallCount;
    for (let index = 0; index < 30; index++) clock.advance(20);
    expect(clock.pendingFrames()).toBe(1);
    for (let index = 0; index < 10; index++) clock.advance(20);
    const totalTicks = emit.mock.calls.length - dragCallCount;

    expect(firstFrameTicks).toBeLessThanOrEqual(4);
    expect(totalTicks).toBeLessThanOrEqual(Math.floor(720 / 12));
    expect(clock.pendingFrames()).toBe(0);
  });

  it("cancels momentum on a new touch or cancellation", () => {
    const emit = vi.fn();
    const clock = createTiming();
    const coordinator = new TouchWheelCoordinator(
      emit,
      undefined,
      undefined,
      clock.timing,
    );

    coordinator.start(point(100));
    clock.advance(20);
    coordinator.move(point(50));
    coordinator.end();
    expect(clock.pendingFrames()).toBe(1);
    coordinator.start(point(60));
    expect(clock.pendingFrames()).toBe(0);

    clock.advance(20);
    coordinator.move(point(20));
    coordinator.end();
    expect(clock.pendingFrames()).toBe(1);
    coordinator.cancel();
    expect(clock.pendingFrames()).toBe(0);
  });

  it("disables momentum when reduced motion is requested", () => {
    const emit = vi.fn();
    const clock = createTiming(false);
    const coordinator = new TouchWheelCoordinator(
      emit,
      undefined,
      undefined,
      clock.timing,
    );

    coordinator.start(point(100));
    clock.advance(20);
    coordinator.move(point(50));
    coordinator.end();

    expect(clock.pendingFrames()).toBe(0);
    expect(emit).toHaveBeenCalledOnce();
  });

  it("stops momentum if the active terminal mode changes", () => {
    const emit = vi.fn();
    let momentumAllowed = true;
    const clock = createTiming();
    const coordinator = new TouchWheelCoordinator(emit, undefined, undefined, {
      ...clock.timing,
      momentumAllowed: () => momentumAllowed,
    });

    coordinator.start(point(100));
    clock.advance(20);
    coordinator.move(point(50));
    coordinator.end();
    momentumAllowed = false;
    clock.advance(20);

    expect(emit).toHaveBeenCalledOnce();
    expect(clock.pendingFrames()).toBe(0);
  });

  it("retains fractional pixel distance until it forms a whole line tick", () => {
    const emit = vi.fn();
    const clock = createTiming();
    const coordinator = new TouchWheelCoordinator(
      emit,
      undefined,
      undefined,
      clock.timing,
    );

    coordinator.start(point(100));
    clock.advance(100);
    coordinator.move(point(80));
    coordinator.end();
    const dragCallCount = emit.mock.calls.length;
    for (let index = 0; index < 4; index++) clock.advance(16);
    expect(emit.mock.calls.length).toBe(dragCallCount);
    clock.advance(16);
    expect(emit.mock.calls.length).toBeGreaterThan(dragCallCount);
    expect(emit.mock.calls[dragCallCount][0]).toMatchObject({
      deltaY: 1,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
    });
  });
});

describe("installTouchWheelCoordinator", () => {
  it("claims the first single-touch move but preserves taps and multi-touch", () => {
    const terminalElement = document.createElement("div");
    const scrollableElement = document.createElement("div");
    scrollableElement.className = "xterm-scrollable-element";
    const screenElement = document.createElement("div");
    screenElement.className = "xterm-screen";
    scrollableElement.append(screenElement);
    terminalElement.append(scrollableElement);
    const dispose = installTouchWheelCoordinator(terminalElement);

    terminalElement.dispatchEvent(touchEvent("touchstart", [100]));
    const earlyMove = touchEvent("touchmove", [99]);
    terminalElement.dispatchEvent(earlyMove);
    expect(earlyMove.defaultPrevented).toBe(true);

    terminalElement.dispatchEvent(touchEvent("touchend", []));
    const tapEnd = touchEvent("touchend", []);
    terminalElement.dispatchEvent(tapEnd);
    expect(tapEnd.defaultPrevented).toBe(false);

    terminalElement.dispatchEvent(touchEvent("touchstart", [100]));
    const multiTouchMove = touchEvent("touchmove", [90, 80]);
    terminalElement.dispatchEvent(multiTouchMove);
    expect(multiTouchMove.defaultPrevented).toBe(false);
    dispose();
  });

  it("dispatches wheel events at xterm's normal scrollback seam", () => {
    const terminalElement = document.createElement("div");
    const scrollableElement = document.createElement("div");
    scrollableElement.className = "xterm-scrollable-element";
    const screenElement = document.createElement("div");
    const canvas = document.createElement("canvas");
    screenElement.className = "xterm-screen";
    screenElement.append(canvas);
    scrollableElement.append(screenElement);
    terminalElement.append(scrollableElement);
    const scrollableWheel = vi.fn();
    const canvasWheel = vi.fn();
    scrollableElement.addEventListener("wheel", scrollableWheel);
    canvas.addEventListener("wheel", canvasWheel);
    const dispose = installTouchWheelCoordinator(terminalElement);

    canvas.dispatchEvent(touchEvent("touchstart", [100]));
    canvas.dispatchEvent(touchEvent("touchmove", [90]));

    expect(scrollableWheel).toHaveBeenCalledOnce();
    expect(canvasWheel).not.toHaveBeenCalled();
    expect((scrollableWheel.mock.calls[0][0] as WheelEvent).deltaY).toBe(10);
    expect((scrollableWheel.mock.calls[0][0] as WheelEvent).deltaMode).toBe(
      WheelEvent.DOM_DELTA_PIXEL,
    );
    dispose();
  });

  it("dispatches momentum as line-mode wheel ticks from the scrollback seam", () => {
    let now = 0;
    let nextHandle = 1;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      callbacks.delete(handle);
    });

    const terminalElement = document.createElement("div");
    const scrollableElement = document.createElement("div");
    scrollableElement.className = "xterm-scrollable-element";
    const screenElement = document.createElement("div");
    const canvas = document.createElement("canvas");
    screenElement.className = "xterm-screen";
    screenElement.append(canvas);
    scrollableElement.append(screenElement);
    terminalElement.append(scrollableElement);
    const wheels: WheelEvent[] = [];
    scrollableElement.addEventListener("wheel", (event) =>
      wheels.push(event as WheelEvent),
    );
    const dispose = installTouchWheelCoordinator(terminalElement);

    canvas.dispatchEvent(touchEvent("touchstart", [100]));
    now = 20;
    canvas.dispatchEvent(touchEvent("touchmove", [40]));
    canvas.dispatchEvent(touchEvent("touchend", []));
    for (let index = 0; index < 8; index++) {
      now += 16;
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(now));
    }

    const momentum = wheels.filter(
      (event) => event.deltaMode === WheelEvent.DOM_DELTA_LINE,
    );
    expect(momentum.length).toBeGreaterThan(1);
    expect(momentum.every((event) => event.deltaY === 1)).toBe(true);
    expect(wheels.every((event) => event.currentTarget === null)).toBe(true);
    dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
