export const LOCAL_ADAPTIVE_ENGINE_KEY = "termix.local.adaptive-engine.v1";

const VERSION = 1;
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SCOPES = 128;
const MAX_ACTIONS_PER_SCOPE = 12;
const DEFAULT_MIN_EVIDENCE = 2.5;
const DEFAULT_MIN_SHARE = 0.6;
const DEFAULT_MIN_MARGIN = 1;
const EWMA_ALPHA = 0.25;

export interface LocalAdaptiveOutcome {
  success?: boolean;
  latencyMs?: number;
  cancelled?: boolean;
  fallback?: boolean;
}

export interface LocalAdaptiveActionStats {
  weight: number;
  updatedAt: number;
  observations: number;
  successes: number;
  cancellations: number;
  fallbacks: number;
  latencyEwmaMs?: number;
}

interface AdaptiveScope {
  actions: Record<string, LocalAdaptiveActionStats>;
  updatedAt: number;
}

interface AdaptiveStore {
  version: typeof VERSION;
  scopes: Record<string, AdaptiveScope>;
}

export interface LocalAdaptiveDecision<T extends string> {
  action: T;
  confidence: number;
  reason: "fallback" | "insufficient-evidence" | "learned";
  expiresAt: number;
}

interface DecisionOptions<T extends string> {
  scope: string;
  candidates: readonly T[];
  fallback: T;
  now?: number;
  ttlMs?: number;
  minEvidence?: number;
  minShare?: number;
  minMargin?: number;
}

function emptyStore(): AdaptiveStore {
  return { version: VERSION, scopes: {} };
}

function finiteNonNegative(value: unknown): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;
}

function sanitizeAction(value: unknown): LocalAdaptiveActionStats | null {
  if (!value || typeof value !== "object") return null;
  const stat = value as Partial<LocalAdaptiveActionStats>;
  if (
    !Number.isFinite(stat.weight) ||
    Number(stat.weight) < 0 ||
    !Number.isFinite(stat.updatedAt)
  ) {
    return null;
  }
  const latencyEwmaMs = finiteNonNegative(stat.latencyEwmaMs);
  return {
    weight: Number(stat.weight),
    updatedAt: Number(stat.updatedAt),
    observations: finiteNonNegative(stat.observations),
    successes: finiteNonNegative(stat.successes),
    cancellations: finiteNonNegative(stat.cancellations),
    fallbacks: finiteNonNegative(stat.fallbacks),
    ...(latencyEwmaMs > 0 ? { latencyEwmaMs } : {}),
  };
}

function sanitizeStore(value: unknown): AdaptiveStore {
  if (!value || typeof value !== "object") return emptyStore();
  const candidate = value as Partial<AdaptiveStore>;
  if (
    candidate.version !== VERSION ||
    !candidate.scopes ||
    typeof candidate.scopes !== "object" ||
    Array.isArray(candidate.scopes)
  ) {
    return emptyStore();
  }

  const scopes: Record<string, AdaptiveScope> = {};
  for (const [scope, rawScope] of Object.entries(candidate.scopes)) {
    if (!rawScope || typeof rawScope !== "object") continue;
    const value = rawScope as Partial<AdaptiveScope>;
    if (
      !Number.isFinite(value.updatedAt) ||
      !value.actions ||
      typeof value.actions !== "object" ||
      Array.isArray(value.actions)
    ) {
      continue;
    }
    const actions: Record<string, LocalAdaptiveActionStats> = {};
    for (const [action, rawStat] of Object.entries(value.actions)) {
      const stat = sanitizeAction(rawStat);
      if (stat) actions[action] = stat;
    }
    scopes[scope] = { actions, updatedAt: Number(value.updatedAt) };
  }
  return { version: VERSION, scopes };
}

function readStore(): AdaptiveStore {
  if (typeof localStorage === "undefined") return emptyStore();
  try {
    return sanitizeStore(
      JSON.parse(localStorage.getItem(LOCAL_ADAPTIVE_ENGINE_KEY) ?? "null"),
    );
  } catch {
    return emptyStore();
  }
}

function writeStore(store: AdaptiveStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_ADAPTIVE_ENGINE_KEY, JSON.stringify(store));
  } catch {
    // Local adaptation is optional and must never block the requested action.
  }
}

function decayedWeight(stat: LocalAdaptiveActionStats, now: number): number {
  const age = Math.max(0, now - stat.updatedAt);
  return stat.weight * 2 ** (-age / HALF_LIFE_MS);
}

function trimStore(store: AdaptiveStore, now: number): void {
  for (const scope of Object.values(store.scopes)) {
    scope.actions = Object.fromEntries(
      Object.entries(scope.actions)
        .sort(([, a], [, b]) => decayedWeight(b, now) - decayedWeight(a, now))
        .slice(0, MAX_ACTIONS_PER_SCOPE),
    );
  }
  store.scopes = Object.fromEntries(
    Object.entries(store.scopes)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SCOPES),
  );
}

function updateEwma(previous: number | undefined, value: number): number {
  return previous === undefined
    ? value
    : previous + EWMA_ALPHA * (value - previous);
}

function getActionStats(
  store: AdaptiveStore,
  scope: string,
  action: string,
  now: number,
): [AdaptiveScope, LocalAdaptiveActionStats] {
  const scopeStats = store.scopes[scope] ?? { actions: {}, updatedAt: now };
  return [
    scopeStats,
    scopeStats.actions[action] ?? {
      weight: 0,
      updatedAt: now,
      observations: 0,
      successes: 0,
      cancellations: 0,
      fallbacks: 0,
    },
  ];
}

function saveActionStats(
  store: AdaptiveStore,
  scope: string,
  action: string,
  scopeStats: AdaptiveScope,
  actionStats: LocalAdaptiveActionStats,
  now: number,
): void {
  scopeStats.actions[action] = actionStats;
  scopeStats.updatedAt = now;
  store.scopes[scope] = scopeStats;
  trimStore(store, now);
  writeStore(store);
}

/** Records an abstract user choice. Never pass raw paths, input, or content. */
export function recordLocalAdaptiveChoice(
  scope: string,
  action: string,
  now = Date.now(),
): void {
  if (!scope || !action) return;
  const store = readStore();
  const [scopeStats, previous] = getActionStats(store, scope, action, now);
  saveActionStats(
    store,
    scope,
    action,
    scopeStats,
    {
      ...previous,
      weight: decayedWeight(previous, now) + 1,
      updatedAt: now,
    },
    now,
  );
}

/** Records performance separately so failed actions are not reinforced. */
export function recordLocalAdaptiveOutcome(
  scope: string,
  action: string,
  outcome: LocalAdaptiveOutcome,
  now = Date.now(),
): void {
  if (
    !scope ||
    !action ||
    !Object.values(outcome).some((v) => v !== undefined)
  ) {
    return;
  }
  const store = readStore();
  const [scopeStats, previous] = getActionStats(store, scope, action, now);
  const latency = finiteNonNegative(outcome.latencyMs);
  saveActionStats(
    store,
    scope,
    action,
    scopeStats,
    {
      ...previous,
      updatedAt: now,
      observations: previous.observations + 1,
      successes: previous.successes + (outcome.success === true ? 1 : 0),
      cancellations:
        previous.cancellations + (outcome.cancelled === true ? 1 : 0),
      fallbacks: previous.fallbacks + (outcome.fallback === true ? 1 : 0),
      ...(latency > 0
        ? { latencyEwmaMs: updateEwma(previous.latencyEwmaMs, latency) }
        : {}),
    },
    now,
  );
}

export function chooseLocalAdaptiveAction<T extends string>({
  scope,
  candidates,
  fallback,
  now = Date.now(),
  ttlMs = 5 * 60 * 1000,
  minEvidence = DEFAULT_MIN_EVIDENCE,
  minShare = DEFAULT_MIN_SHARE,
  minMargin = DEFAULT_MIN_MARGIN,
}: DecisionOptions<T>): LocalAdaptiveDecision<T> {
  const expiresAt = now + Math.max(0, ttlMs);
  const stats = readStore().scopes[scope]?.actions;
  if (!stats || candidates.length === 0) {
    return { action: fallback, confidence: 0, reason: "fallback", expiresAt };
  }

  const ranked = candidates
    .map((action) => ({
      action,
      weight: stats[action] ? decayedWeight(stats[action], now) : 0,
    }))
    .sort((a, b) => b.weight - a.weight);
  const total = ranked.reduce((sum, item) => sum + item.weight, 0);
  const [best, second] = ranked;
  if (!best || total <= 0) {
    return { action: fallback, confidence: 0, reason: "fallback", expiresAt };
  }

  const share = best.weight / total;
  const margin = best.weight - (second?.weight ?? 0);
  const confidence = Math.min(
    1,
    best.weight / Math.max(minEvidence, Number.EPSILON),
    share / Math.max(minShare, Number.EPSILON),
    margin / Math.max(minMargin, Number.EPSILON),
  );
  const learned =
    best.weight >= minEvidence && share >= minShare && margin >= minMargin;
  return {
    action: learned ? best.action : fallback,
    confidence,
    reason: learned ? "learned" : "insufficient-evidence",
    expiresAt,
  };
}

export function getLocalAdaptiveStats(
  scope: string,
): Readonly<Record<string, LocalAdaptiveActionStats>> {
  return readStore().scopes[scope]?.actions ?? {};
}

export function clearLocalAdaptiveEngine(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LOCAL_ADAPTIVE_ENGINE_KEY);
  } catch {
    // Local adaptation is optional in restricted storage modes.
  }
}
