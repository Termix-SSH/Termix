export interface TouchWheelPoint {
  clientX: number;
  clientY: number;
}

export interface SyntheticWheelInput extends TouchWheelPoint {
  deltaY: number;
  deltaMode: number;
}

const DEFAULT_DRAG_THRESHOLD_PX = 6;
const DEFAULT_MAX_WHEEL_DELTA_PX = 120;
const MOMENTUM_SAMPLE_WINDOW_MS = 100;
const MOMENTUM_RELEASE_GRACE_MS = 120;
const MOMENTUM_MIN_VELOCITY_PX_PER_MS = 0.15;
const MOMENTUM_MAX_VELOCITY_PX_PER_MS = 2.5;
const MOMENTUM_MAX_DURATION_MS = 1_000;
const MOMENTUM_MAX_TRAVEL_PX = 720;
const MOMENTUM_DECAY_TIME_MS = 300;
const MOMENTUM_PIXELS_PER_TICK = 12;
const MOMENTUM_MAX_FRAME_MS = 32;
const MOMENTUM_MAX_TICKS_PER_FRAME = 4;

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
    private readonly dragThresholdPx = DEFAULT_DRAG_THRESHOLD_PX,
    private readonly maxWheelDeltaPx = DEFAULT_MAX_WHEEL_DELTA_PX,
    private readonly timing: TouchWheelTiming = defaultTiming,
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
        (sample) => time - sample.endedAt <= MOMENTUM_SAMPLE_WINDOW_MS,
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
      Math.abs(velocity) >= MOMENTUM_MIN_VELOCITY_PX_PER_MS
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
      time - newestSampleTime > MOMENTUM_RELEASE_GRACE_MS
    ) {
      return 0;
    }
    const samples = this.velocitySamples.filter(
      (sample) =>
        newestSampleTime - sample.endedAt <= MOMENTUM_SAMPLE_WINDOW_MS,
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
      -MOMENTUM_MAX_VELOCITY_PX_PER_MS,
      Math.min(MOMENTUM_MAX_VELOCITY_PX_PER_MS, distance / duration),
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
      const remainingTravel = MOMENTUM_MAX_TRAVEL_PX - travelled;
      if (elapsed > MOMENTUM_MAX_DURATION_MS || remainingTravel <= 0) {
        this.momentumFrame = undefined;
        return;
      }

      const duration = Math.min(
        Math.max(0, time - lastTime),
        MOMENTUM_MAX_FRAME_MS,
      );
      if (duration > 0) {
        const frameStart = Math.max(0, elapsed - duration);
        const distance =
          Math.abs(initialVelocity) *
          MOMENTUM_DECAY_TIME_MS *
          (Math.exp(-frameStart / MOMENTUM_DECAY_TIME_MS) -
            Math.exp(-elapsed / MOMENTUM_DECAY_TIME_MS));
        const deltaY =
          Math.sign(initialVelocity) * Math.min(distance, remainingTravel);
        this.flushMomentum(point, deltaY);
        travelled += Math.abs(deltaY);
      }

      lastTime = time;
      if (
        elapsed < MOMENTUM_MAX_DURATION_MS &&
        travelled < MOMENTUM_MAX_TRAVEL_PX
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
      Math.abs(this.momentumRemainderY) / MOMENTUM_PIXELS_PER_TICK,
    );
    const tickCount = Math.min(availableTicks, MOMENTUM_MAX_TICKS_PER_FRAME);
    const direction = Math.sign(this.momentumRemainderY);
    for (let index = 0; index < tickCount; index++) {
      this.emitWheel({
        ...point,
        deltaY: direction,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
      });
    }
    this.momentumRemainderY -= direction * tickCount * MOMENTUM_PIXELS_PER_TICK;
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
): () => void {
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
    DEFAULT_DRAG_THRESHOLD_PX,
    DEFAULT_MAX_WHEEL_DELTA_PX,
    {
      ...defaultTiming,
      momentumAllowed: () =>
        momentumAllowed() &&
        !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    },
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
