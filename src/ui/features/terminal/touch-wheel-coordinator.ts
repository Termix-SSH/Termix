import {
  TOUCH_INPUT_DEFAULTS,
  type TouchInputSettings,
} from "@/types/touch-input-settings";

export interface TouchWheelPoint {
  clientX: number;
  clientY: number;
}

export interface SyntheticWheelInput extends TouchWheelPoint {
  deltaY: number;
  deltaMode: number;
}

interface TouchWheelTiming {
  now: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  momentumAllowed: () => boolean;
}

const defaultTiming: TouchWheelTiming = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  momentumAllowed: () => true,
};

interface VelocitySample {
  deltaY: number;
  durationMs: number;
  endedAt: number;
}

export class TouchWheelCoordinator {
  private startY: number | undefined;
  private lastPoint: TouchWheelPoint | undefined;
  private pendingDeltaY = 0;
  private scrolling = false;
  private cancelled = false;
  private velocitySamples: VelocitySample[] = [];
  private lastMoveTime: number | undefined;
  private momentumFrame: number | undefined;
  private momentumRemainderY = 0;

  constructor(
    private readonly emitWheel: (input: SyntheticWheelInput) => void,
    private readonly dragThresholdPx: number = TOUCH_INPUT_DEFAULTS.dragThresholdPx,
    private readonly maxWheelDeltaPx: number = TOUCH_INPUT_DEFAULTS.maxWheelDeltaPx,
    private readonly timing: TouchWheelTiming = defaultTiming,
    private readonly settings: TouchInputSettings = TOUCH_INPUT_DEFAULTS,
  ) {}

  start(point: TouchWheelPoint | undefined, time = this.timing.now()): void {
    this.reset();
    if (!point) {
      this.cancelled = true;
      return;
    }
    this.startY = point.clientY;
    this.lastPoint = point;
    this.lastMoveTime = time;
  }

  move(point: TouchWheelPoint | undefined, time = this.timing.now()): boolean {
    if (this.cancelled || !point || !this.lastPoint) {
      if (!point) this.cancel();
      return false;
    }

    const deltaY = this.lastPoint.clientY - point.clientY;
    this.pendingDeltaY += deltaY;
    this.lastPoint = point;
    if (this.lastMoveTime !== undefined && time > this.lastMoveTime) {
      this.velocitySamples.push({
        deltaY,
        durationMs: time - this.lastMoveTime,
        endedAt: time,
      });
      this.velocitySamples = this.velocitySamples.filter(
        (sample) =>
          time - sample.endedAt <= this.settings.momentumSampleWindowMs,
      );
    }
    this.lastMoveTime = time;

    if (!this.scrolling) {
      if (Math.abs(point.clientY - this.startY!) < this.dragThresholdPx) {
        return true;
      }
      this.scrolling = true;
    }

    this.flush(point);
    return true;
  }

  end(time = this.timing.now()): void {
    const point = this.lastPoint;
    const velocity = this.scrolling ? this.recentVelocity(time) : 0;
    this.clearGesture();
    if (
      point &&
      this.timing.momentumAllowed() &&
      Math.abs(velocity) >= this.settings.minimumVelocityPxPerMs
    ) {
      this.startMomentum(point, velocity, time);
    }
  }

  cancel(): void {
    this.reset();
    this.cancelled = true;
  }

  private flush(point: TouchWheelPoint): void {
    while (Math.abs(this.pendingDeltaY) > this.maxWheelDeltaPx) {
      const deltaY = Math.sign(this.pendingDeltaY) * this.maxWheelDeltaPx;
      this.emitWheel({
        ...point,
        deltaY,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      });
      this.pendingDeltaY -= deltaY;
    }
    if (this.pendingDeltaY !== 0) {
      this.emitWheel({
        ...point,
        deltaY: this.pendingDeltaY,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      });
      this.pendingDeltaY = 0;
    }
  }

  private reset(): void {
    this.stopMomentum();
    this.clearGesture();
    this.cancelled = false;
  }

  private clearGesture(): void {
    this.startY = undefined;
    this.lastPoint = undefined;
    this.pendingDeltaY = 0;
    this.scrolling = false;
    this.velocitySamples = [];
    this.lastMoveTime = undefined;
  }

  private recentVelocity(time: number): number {
    const newestSampleTime = this.velocitySamples.at(-1)?.endedAt;
    if (
      newestSampleTime === undefined ||
      time - newestSampleTime > this.settings.releaseGracePeriodMs
    ) {
      return 0;
    }
    const samples = this.velocitySamples.filter(
      (sample) =>
        newestSampleTime - sample.endedAt <=
        this.settings.momentumSampleWindowMs,
    );
    const duration = samples.reduce(
      (total, sample) => total + sample.durationMs,
      0,
    );
    if (duration === 0) return 0;
    const distance = samples.reduce(
      (total, sample) => total + sample.deltaY,
      0,
    );
    return Math.max(
      -this.settings.maximumVelocityPxPerMs,
      Math.min(this.settings.maximumVelocityPxPerMs, distance / duration),
    );
  }

  private startMomentum(
    point: TouchWheelPoint,
    initialVelocity: number,
    startedAt: number,
  ): void {
    let lastTime = startedAt;
    let travelled = 0;

    const step = (time: number) => {
      if (!this.timing.momentumAllowed()) {
        this.momentumFrame = undefined;
        this.momentumRemainderY = 0;
        return;
      }

      const elapsed = Math.max(0, time - startedAt);
      const remainingTravel = this.settings.maximumTravelPx - travelled;
      if (elapsed > this.settings.maximumDurationMs || remainingTravel <= 0) {
        this.momentumFrame = undefined;
        return;
      }

      const duration = Math.min(
        Math.max(0, time - lastTime),
        this.settings.maximumFrameIntervalMs,
      );
      if (duration > 0) {
        const frameStart = Math.max(0, elapsed - duration);
        const distance =
          Math.abs(initialVelocity) *
          this.settings.decayTimeMs *
          (Math.exp(-frameStart / this.settings.decayTimeMs) -
            Math.exp(-elapsed / this.settings.decayTimeMs));
        const deltaY =
          Math.sign(initialVelocity) * Math.min(distance, remainingTravel);
        this.flushMomentum(point, deltaY);
        travelled += Math.abs(deltaY);
      }

      lastTime = time;
      if (
        elapsed < this.settings.maximumDurationMs &&
        travelled < this.settings.maximumTravelPx
      ) {
        this.momentumFrame = this.timing.requestFrame(step);
      } else {
        this.momentumFrame = undefined;
      }
    };

    this.momentumFrame = this.timing.requestFrame(step);
  }

  private flushMomentum(point: TouchWheelPoint, deltaY: number): void {
    this.momentumRemainderY += deltaY;
    const availableTicks = Math.trunc(
      Math.abs(this.momentumRemainderY) / this.settings.pixelsPerTick,
    );
    const tickCount = Math.min(
      availableTicks,
      this.settings.maximumTicksPerFrame,
    );
    const direction = Math.sign(this.momentumRemainderY);
    for (let index = 0; index < tickCount; index++) {
      this.emitWheel({
        ...point,
        deltaY: direction,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
      });
    }
    this.momentumRemainderY -=
      direction * tickCount * this.settings.pixelsPerTick;
  }

  private stopMomentum(): void {
    if (this.momentumFrame !== undefined) {
      this.timing.cancelFrame(this.momentumFrame);
      this.momentumFrame = undefined;
    }
    this.momentumRemainderY = 0;
  }
}

export function installTouchWheelCoordinator(
  terminalElement: HTMLElement,
  momentumAllowed: () => boolean = () => true,
  settings: TouchInputSettings = TOUCH_INPUT_DEFAULTS,
): () => void {
  if (!settings.enabled) return () => {};
  const wheelElement = terminalElement.querySelector<HTMLElement>(
    ".xterm-scrollable-element",
  );
  if (!wheelElement) return () => {};

  const coordinator = new TouchWheelCoordinator(
    ({ deltaY, deltaMode, clientX, clientY }) => {
      wheelElement.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX,
          clientY,
          deltaMode,
          deltaY,
        }),
      );
    },
    settings.dragThresholdPx,
    settings.maxWheelDeltaPx,
    {
      ...defaultTiming,
      momentumAllowed: () =>
        settings.momentumEnabled &&
        momentumAllowed() &&
        !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    },
    settings,
  );

  const getSingleTouch = (event: TouchEvent): Touch | undefined =>
    event.touches.length === 1
      ? (event.touches.item(0) ?? undefined)
      : undefined;

  const handleTouchStart = (event: TouchEvent) => {
    const touch = getSingleTouch(event);
    coordinator.start(touch);
  };
  const handleTouchMove = (event: TouchEvent) => {
    if (coordinator.move(getSingleTouch(event))) event.preventDefault();
  };
  const handleTouchEnd = () => coordinator.end();
  const handleTouchCancel = () => coordinator.cancel();

  terminalElement.addEventListener("touchstart", handleTouchStart, {
    passive: true,
  });
  terminalElement.addEventListener("touchmove", handleTouchMove, {
    passive: false,
  });
  terminalElement.addEventListener("touchend", handleTouchEnd, {
    passive: true,
  });
  terminalElement.addEventListener("touchcancel", handleTouchCancel, {
    passive: true,
  });

  return () => {
    coordinator.cancel();
    terminalElement.removeEventListener("touchstart", handleTouchStart);
    terminalElement.removeEventListener("touchmove", handleTouchMove);
    terminalElement.removeEventListener("touchend", handleTouchEnd);
    terminalElement.removeEventListener("touchcancel", handleTouchCancel);
  };
}
