import { getTouchInputSettings } from "@/api/touch-input-settings-api";
import { TOUCH_INPUT_DEFAULTS, type TouchInputSettings } from "@/types/touch-input-settings";

let cached: TouchInputSettings | undefined;
let pending: Promise<TouchInputSettings> | undefined;

export function loadTouchInputSettings(): Promise<TouchInputSettings> {
  if (cached) return Promise.resolve(cached);
  pending ??= getTouchInputSettings()
    .then((settings) => (cached = settings))
    .catch(() => (cached = { ...TOUCH_INPUT_DEFAULTS }))
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

export function cacheTouchInputSettings(settings: TouchInputSettings): void {
  cached = settings;
}

export function resetTouchInputSettingsCache(): void {
  cached = undefined;
  pending = undefined;
}
