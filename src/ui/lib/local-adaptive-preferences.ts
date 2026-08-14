import type { TabType } from "@/types/ui-types";

export const LOCAL_ADAPTIVE_PREFERENCES_KEY =
  "termix.local.adaptive-preferences.v1";

const VERSION = 1;
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SCOPES = 128;
const MAX_ACTIONS_PER_SCOPE = 12;
const MIN_EFFECTIVE_WEIGHT = 2.5;
const MIN_SHARE = 0.6;
const MIN_MARGIN = 1;

interface ActionStat {
  weight: number;
  updatedAt: number;
}

interface PreferenceScope {
  actions: Record<string, ActionStat>;
  updatedAt: number;
}

interface PreferenceStore {
  version: typeof VERSION;
  scopes: Record<string, PreferenceScope>;
}

function emptyStore(): PreferenceStore {
  return { version: VERSION, scopes: {} };
}

function sanitizeStore(value: unknown): PreferenceStore {
  if (!value || typeof value !== "object") return emptyStore();
  const candidate = value as Partial<PreferenceStore>;
  if (
    candidate.version !== VERSION ||
    !candidate.scopes ||
    typeof candidate.scopes !== "object" ||
    Array.isArray(candidate.scopes)
  ) {
    return emptyStore();
  }

  const scopes: Record<string, PreferenceScope> = {};
  for (const [scope, rawScope] of Object.entries(candidate.scopes)) {
    if (!rawScope || typeof rawScope !== "object") continue;
    const value = rawScope as Partial<PreferenceScope>;
    if (
      !Number.isFinite(value.updatedAt) ||
      !value.actions ||
      typeof value.actions !== "object" ||
      Array.isArray(value.actions)
    ) {
      continue;
    }
    const actions: Record<string, ActionStat> = {};
    for (const [action, rawStat] of Object.entries(value.actions)) {
      if (!rawStat || typeof rawStat !== "object") continue;
      const stat = rawStat as Partial<ActionStat>;
      if (
        Number.isFinite(stat.weight) &&
        Number.isFinite(stat.updatedAt) &&
        Number(stat.weight) > 0
      ) {
        actions[action] = {
          weight: Number(stat.weight),
          updatedAt: Number(stat.updatedAt),
        };
      }
    }
    scopes[scope] = {
      actions,
      updatedAt: Number(value.updatedAt),
    };
  }
  return { version: VERSION, scopes };
}

function readStore(): PreferenceStore {
  if (typeof localStorage === "undefined") return emptyStore();
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(LOCAL_ADAPTIVE_PREFERENCES_KEY) ?? "null",
    );
    return sanitizeStore(parsed);
  } catch {
    return emptyStore();
  }
}

function writeStore(store: PreferenceStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_ADAPTIVE_PREFERENCES_KEY, JSON.stringify(store));
  } catch {
    // Learning is optional; storage limits or privacy modes must not affect UX.
  }
}

function decayedWeight(stat: ActionStat, now: number): number {
  const age = Math.max(0, now - stat.updatedAt);
  return stat.weight * 2 ** (-age / HALF_LIFE_MS);
}

function trimStore(store: PreferenceStore): void {
  const scopes = Object.entries(store.scopes).sort(
    ([, a], [, b]) => b.updatedAt - a.updatedAt,
  );
  store.scopes = Object.fromEntries(scopes.slice(0, MAX_SCOPES));
}

/** Records an abstract action locally. Callers must not use raw paths or input. */
export function recordLocalPreference(
  scope: string,
  action: string,
  now = Date.now(),
): void {
  if (!scope || !action) return;
  const store = readStore();
  const current = store.scopes[scope] ?? { actions: {}, updatedAt: now };
  const previous = current.actions[action];
  current.actions[action] = {
    weight: (previous ? decayedWeight(previous, now) : 0) + 1,
    updatedAt: now,
  };
  current.updatedAt = now;

  const actions = Object.entries(current.actions).sort(
    ([, a], [, b]) => decayedWeight(b, now) - decayedWeight(a, now),
  );
  current.actions = Object.fromEntries(actions.slice(0, MAX_ACTIONS_PER_SCOPE));
  store.scopes[scope] = current;
  trimStore(store);
  writeStore(store);
}

/** Returns a learned action only after enough consistent local evidence. */
export function getLocalPreference<T extends string>(
  scope: string,
  candidates: readonly T[],
  fallback: T,
  now = Date.now(),
): T {
  const stats = readStore().scopes[scope]?.actions;
  if (!stats || candidates.length === 0) return fallback;

  const ranked = candidates
    .map((action) => ({
      action,
      weight: stats[action] ? decayedWeight(stats[action], now) : 0,
    }))
    .sort((a, b) => b.weight - a.weight);
  const total = ranked.reduce((sum, item) => sum + item.weight, 0);
  const [best, second] = ranked;
  if (
    !best ||
    best.weight < MIN_EFFECTIVE_WEIGHT ||
    best.weight / total < MIN_SHARE ||
    best.weight - (second?.weight ?? 0) < MIN_MARGIN
  ) {
    return fallback;
  }
  return best.action;
}

export function clearLocalAdaptivePreferences(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LOCAL_ADAPTIVE_PREFERENCES_KEY);
  } catch {
    // Optional local learning must remain safe in restricted storage modes.
  }
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
