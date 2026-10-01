export const TOUCH_INPUT_SETTING_KEY = "touch_input_settings";

export interface TouchInputSettings {
  enabled: boolean;
  momentumEnabled: boolean;
  dragThresholdPx: number;
  maxWheelDeltaPx: number;
  momentumSampleWindowMs: number;
  releaseGracePeriodMs: number;
  minimumVelocityPxPerMs: number;
  maximumVelocityPxPerMs: number;
  maximumDurationMs: number;
  maximumTravelPx: number;
  decayTimeMs: number;
  pixelsPerTick: number;
  maximumFrameIntervalMs: number;
  maximumTicksPerFrame: number;
}

export const TOUCH_INPUT_DEFAULTS: TouchInputSettings = {
  enabled: true,
  momentumEnabled: true,
  dragThresholdPx: 6,
  maxWheelDeltaPx: 120,
  momentumSampleWindowMs: 100,
  releaseGracePeriodMs: 120,
  minimumVelocityPxPerMs: 0.15,
  maximumVelocityPxPerMs: 2.5,
  maximumDurationMs: 1_000,
  maximumTravelPx: 720,
  decayTimeMs: 300,
  pixelsPerTick: 12,
  maximumFrameIntervalMs: 32,
  maximumTicksPerFrame: 4,
};

export type TouchInputNumericKey = Exclude<
  keyof TouchInputSettings,
  "enabled" | "momentumEnabled"
>;

export const TOUCH_INPUT_NUMERIC_BOUNDS: Record<
  TouchInputNumericKey,
  { min: number; max: number; step: number }
> = {
  dragThresholdPx: { min: 0, max: 100, step: 1 },
  maxWheelDeltaPx: { min: 1, max: 1_000, step: 1 },
  momentumSampleWindowMs: { min: 10, max: 1_000, step: 10 },
  releaseGracePeriodMs: { min: 0, max: 2_000, step: 10 },
  minimumVelocityPxPerMs: { min: 0, max: 10, step: 0.01 },
  maximumVelocityPxPerMs: { min: 0.01, max: 20, step: 0.01 },
  maximumDurationMs: { min: 0, max: 10_000, step: 100 },
  maximumTravelPx: { min: 0, max: 10_000, step: 10 },
  decayTimeMs: { min: 1, max: 5_000, step: 10 },
  pixelsPerTick: { min: 1, max: 500, step: 1 },
  maximumFrameIntervalMs: { min: 1, max: 1_000, step: 1 },
  maximumTicksPerFrame: { min: 1, max: 100, step: 1 },
};

export function normalizeTouchInputSettings(
  value: unknown,
): TouchInputSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...TOUCH_INPUT_DEFAULTS };
  }

  const input = value as Record<string, unknown>;
  const normalized: TouchInputSettings = { ...TOUCH_INPUT_DEFAULTS };
  for (const key of ["enabled", "momentumEnabled"] as const) {
    if (typeof input[key] === "boolean") normalized[key] = input[key];
  }
  for (const [key, bounds] of Object.entries(TOUCH_INPUT_NUMERIC_BOUNDS) as [
    TouchInputNumericKey,
    { min: number; max: number },
  ][]) {
    const candidate = input[key];
    if (
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= bounds.min &&
      candidate <= bounds.max
    ) {
      normalized[key] = candidate;
    }
  }
  return normalized;
}

export function validateTouchInputSettingsUpdate(
  value: unknown,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "settings must be an object";
  }
  const input = value as Record<string, unknown>;
  const validKeys = new Set(Object.keys(TOUCH_INPUT_DEFAULTS));
  const unknownKey = Object.keys(input).find((key) => !validKeys.has(key));
  if (unknownKey) return `Unknown touch input setting: ${unknownKey}`;
  for (const key of ["enabled", "momentumEnabled"] as const) {
    if (key in input && typeof input[key] !== "boolean") {
      return `${key} must be a boolean`;
    }
  }
  for (const [key, bounds] of Object.entries(TOUCH_INPUT_NUMERIC_BOUNDS) as [
    TouchInputNumericKey,
    { min: number; max: number },
  ][]) {
    if (!(key in input)) continue;
    const candidate = input[key];
    if (
      typeof candidate !== "number" ||
      !Number.isFinite(candidate) ||
      candidate < bounds.min ||
      candidate > bounds.max
    ) {
      return `${key} must be a number between ${bounds.min} and ${bounds.max}`;
    }
  }
  if (
    typeof input.minimumVelocityPxPerMs === "number" &&
    typeof input.maximumVelocityPxPerMs === "number" &&
    input.minimumVelocityPxPerMs > input.maximumVelocityPxPerMs
  ) {
    return "minimumVelocityPxPerMs must not exceed maximumVelocityPxPerMs";
  }
  return null;
}
