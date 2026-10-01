import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import { getClientSettings } from "../terminal-api";
import {
  TOUCH_INPUT_DEFAULTS,
  type TouchInputSettings,
} from "../../shared/touch-input-settings";

let cached: TouchInputSettings | undefined;
let pending: Promise<TouchInputSettings> | undefined;

export function loadTouchInputSettings(
  api: PluginApiClient,
): Promise<TouchInputSettings> {
  if (cached) return Promise.resolve(cached);
  pending ??= getClientSettings(api)
    .then((settings) => (cached = settings.touchInput))
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
