import type { TabType } from "@/types/ui-types";
import {
  chooseLocalAdaptiveAction,
  clearLocalAdaptiveEngine,
  LOCAL_ADAPTIVE_ENGINE_KEY,
  recordLocalAdaptiveChoice,
} from "./local-adaptive-engine";

export const LOCAL_ADAPTIVE_PREFERENCES_KEY = LOCAL_ADAPTIVE_ENGINE_KEY;

/** Records an abstract action locally. Callers must not use raw paths or input. */
export function recordLocalPreference(
  scope: string,
  action: string,
  now = Date.now(),
): void {
  recordLocalAdaptiveChoice(scope, action, now);
}

/** Returns a learned action only after enough consistent local evidence. */
export function getLocalPreference<T extends string>(
  scope: string,
  candidates: readonly T[],
  fallback: T,
  now = Date.now(),
): T {
  return chooseLocalAdaptiveAction({
    scope,
    candidates,
    fallback,
    now,
  }).action;
}

export function clearLocalAdaptivePreferences(): void {
  clearLocalAdaptiveEngine();
}

const hostActionScope = (hostId: string) => `host-action:${hostId}`;

export function recordHostActionPreference(
  hostId: string,
  action: TabType,
): void {
  recordLocalPreference(hostActionScope(hostId), action);
}

export function getPreferredHostAction(
  hostId: string,
  candidates: readonly TabType[],
  fallback: TabType,
): TabType {
  return getLocalPreference(hostActionScope(hostId), candidates, fallback);
}
