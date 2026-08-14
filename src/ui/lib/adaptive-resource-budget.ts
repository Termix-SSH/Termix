import {
  getLocalAdaptiveStats,
  recordLocalAdaptiveOutcome,
} from "./local-adaptive-engine";

export type AdaptiveTaskKind = "module" | "network";
export type AdaptiveResourceTier =
  "paused" | "constrained" | "balanced" | "eager";

export interface AdaptiveResourceEnvironment {
  visible: boolean;
  saveData?: boolean;
  effectiveType?: string;
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
}

export interface AdaptiveResourceFeedback {
  observations: number;
  successes: number;
  cancellations: number;
  fallbacks: number;
  latencyEwmaMs?: number;
}

export interface AdaptiveResourceBudget {
  tier: AdaptiveResourceTier;
  allowModulePreload: boolean;
  allowNetworkPrefetch: boolean;
  maxPrefetchBytes: number;
  maxConcurrentModulePreloads: number;
  maxConcurrentNetworkPrefetches: number;
  reason: "hidden" | "environment" | "feedback" | "default";
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

const scopes: Record<AdaptiveTaskKind, string> = {
  module: "resource-budget:module",
  network: "resource-budget:network",
};
const activeTasks: Record<AdaptiveTaskKind, number> = {
  module: 0,
  network: 0,
};

const budgets: Record<AdaptiveResourceTier, AdaptiveResourceBudget> = {
  paused: {
    tier: "paused",
    allowModulePreload: false,
    allowNetworkPrefetch: false,
    maxPrefetchBytes: 0,
    maxConcurrentModulePreloads: 0,
    maxConcurrentNetworkPrefetches: 0,
    reason: "hidden",
  },
  constrained: {
    tier: "constrained",
    allowModulePreload: false,
    allowNetworkPrefetch: false,
    maxPrefetchBytes: 0,
    maxConcurrentModulePreloads: 0,
    maxConcurrentNetworkPrefetches: 0,
    reason: "environment",
  },
  balanced: {
    tier: "balanced",
    allowModulePreload: true,
    allowNetworkPrefetch: true,
    maxPrefetchBytes: 128 * 1024,
    maxConcurrentModulePreloads: 1,
    maxConcurrentNetworkPrefetches: 1,
    reason: "environment",
  },
  eager: {
    tier: "eager",
    allowModulePreload: true,
    allowNetworkPrefetch: true,
    maxPrefetchBytes: 512 * 1024,
    maxConcurrentModulePreloads: 2,
    maxConcurrentNetworkPrefetches: 2,
    reason: "default",
  },
};

function withReason(
  tier: AdaptiveResourceTier,
  reason: AdaptiveResourceBudget["reason"],
): AdaptiveResourceBudget {
  return { ...budgets[tier], reason };
}

function feedbackIsPoor(feedback?: AdaptiveResourceFeedback): boolean {
  if (!feedback || feedback.observations < 4) return false;
  const failureRate = 1 - feedback.successes / feedback.observations;
  const abandoned = feedback.cancellations + feedback.fallbacks;
  return (
    failureRate > 0.25 ||
    abandoned / feedback.observations > 0.25 ||
    (feedback.latencyEwmaMs ?? 0) > 2_000
  );
}

export function computeAdaptiveResourceBudget(
  environment: AdaptiveResourceEnvironment,
  feedback?: AdaptiveResourceFeedback,
): AdaptiveResourceBudget {
  if (!environment.visible) return withReason("paused", "hidden");
  if (
    environment.saveData ||
    ["slow-2g", "2g", "3g"].includes(environment.effectiveType ?? "")
  ) {
    return withReason("constrained", "environment");
  }

  const limitedDevice =
    (environment.deviceMemoryGb ?? 8) <= 4 ||
    (environment.hardwareConcurrency ?? 8) <= 4;
  const baseline: AdaptiveResourceTier = limitedDevice ? "balanced" : "eager";
  if (!feedbackIsPoor(feedback)) {
    return withReason(baseline, limitedDevice ? "environment" : "default");
  }
  return withReason(
    baseline === "eager" ? "balanced" : "constrained",
    "feedback",
  );
}

function readEnvironment(): AdaptiveResourceEnvironment {
  const navigatorLike =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & {
          connection?: NetworkInformationLike;
          deviceMemory?: number;
        });
  return {
    visible:
      typeof document === "undefined" || document.visibilityState !== "hidden",
    saveData: navigatorLike?.connection?.saveData,
    effectiveType: navigatorLike?.connection?.effectiveType,
    deviceMemoryGb: navigatorLike?.deviceMemory,
    hardwareConcurrency: navigatorLike?.hardwareConcurrency,
  };
}

function readFeedback(kind: AdaptiveTaskKind): AdaptiveResourceFeedback {
  const stats = Object.values(getLocalAdaptiveStats(scopes[kind]));
  const observations = stats.reduce((sum, stat) => sum + stat.observations, 0);
  const latencySamples = stats.filter(
    (stat) => stat.latencyEwmaMs !== undefined && stat.observations > 0,
  );
  const latencyWeight = latencySamples.reduce(
    (sum, stat) => sum + stat.observations,
    0,
  );
  return {
    observations,
    successes: stats.reduce((sum, stat) => sum + stat.successes, 0),
    cancellations: stats.reduce((sum, stat) => sum + stat.cancellations, 0),
    fallbacks: stats.reduce((sum, stat) => sum + stat.fallbacks, 0),
    ...(latencyWeight > 0
      ? {
          latencyEwmaMs:
            latencySamples.reduce(
              (sum, stat) =>
                sum + (stat.latencyEwmaMs ?? 0) * stat.observations,
              0,
            ) / latencyWeight,
        }
      : {}),
  };
}

export function getAdaptiveResourceBudget(
  kind: AdaptiveTaskKind,
): AdaptiveResourceBudget {
  return computeAdaptiveResourceBudget(readEnvironment(), readFeedback(kind));
}

interface AdaptiveTaskOptions {
  estimatedBytes?: number;
}

/** Starts optional work only when it fits the current local resource budget. */
export function runAdaptiveBackgroundTask(
  kind: AdaptiveTaskKind,
  action: string,
  task: () => Promise<unknown>,
  options: AdaptiveTaskOptions = {},
): boolean {
  const budget = getAdaptiveResourceBudget(kind);
  const allowed =
    kind === "module"
      ? budget.allowModulePreload
      : budget.allowNetworkPrefetch &&
        (options.estimatedBytes === undefined ||
          options.estimatedBytes <= budget.maxPrefetchBytes);
  const concurrency =
    kind === "module"
      ? budget.maxConcurrentModulePreloads
      : budget.maxConcurrentNetworkPrefetches;
  if (!allowed || activeTasks[kind] >= concurrency) return false;

  activeTasks[kind] += 1;
  const startedAt = performance.now();
  void Promise.resolve()
    .then(task)
    .then(
      () =>
        recordLocalAdaptiveOutcome(scopes[kind], action, {
          success: true,
          latencyMs: performance.now() - startedAt,
        }),
      () =>
        recordLocalAdaptiveOutcome(scopes[kind], action, {
          success: false,
          latencyMs: performance.now() - startedAt,
        }),
    )
    .finally(() => {
      activeTasks[kind] -= 1;
    });
  return true;
}
