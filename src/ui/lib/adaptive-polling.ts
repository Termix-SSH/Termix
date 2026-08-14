export interface AdaptivePollingPolicy {
  minIntervalMs: number;
  maxIntervalMs: number;
  stablePollsPerStep?: number;
  jitterRatio?: number;
}

export interface AdaptivePollingState {
  stablePolls: number;
  consecutiveFailures: number;
}

export type AdaptivePollResult = boolean | void;

export function computeAdaptivePollDelay(
  policy: AdaptivePollingPolicy,
  state: AdaptivePollingState,
  random = Math.random,
): number {
  const min = Math.max(250, policy.minIntervalMs);
  const max = Math.max(min, policy.maxIntervalMs);
  const stableStep = Math.floor(
    state.stablePolls / Math.max(1, policy.stablePollsPerStep ?? 3),
  );
  const exponent = state.consecutiveFailures || stableStep;
  const base = Math.min(max, min * 2 ** Math.min(exponent, 10));
  const jitterRatio = Math.max(0, Math.min(0.5, policy.jitterRatio ?? 0.1));
  const jitter = base * jitterRatio * (random() * 2 - 1);
  return Math.max(min, Math.min(max, Math.round(base + jitter)));
}

export function runAdaptivePolling(
  poll: () => AdaptivePollResult | Promise<AdaptivePollResult>,
  policy: AdaptivePollingPolicy,
  options: {
    enabled?: () => boolean;
    visible?: () => boolean;
    runImmediately?: boolean;
    random?: () => number;
    onError?: (error: unknown) => void;
  } = {},
): () => void {
  const enabled = options.enabled ?? (() => true);
  const visible =
    options.visible ??
    (() =>
      typeof document === "undefined" || document.visibilityState !== "hidden");
  const state: AdaptivePollingState = {
    stablePolls: 0,
    consecutiveFailures: 0,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inFlight = false;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clearTimer();
    if (stopped || !enabled() || !visible()) return;
    timer = setTimeout(
      () => void tick(),
      computeAdaptivePollDelay(policy, state, options.random),
    );
  };

  const tick = async () => {
    if (stopped || inFlight || !enabled() || !visible()) return;
    inFlight = true;
    try {
      const changed = await poll();
      state.consecutiveFailures = 0;
      state.stablePolls = changed === false ? state.stablePolls + 1 : 0;
    } catch (error) {
      state.stablePolls = 0;
      state.consecutiveFailures += 1;
      options.onError?.(error);
    } finally {
      inFlight = false;
      schedule();
    }
  };

  const onVisibility = () => {
    if (!visible()) {
      clearTimer();
      return;
    }
    state.stablePolls = 0;
    state.consecutiveFailures = 0;
    void tick();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  if (options.runImmediately ?? true) void tick();
  else schedule();

  return () => {
    stopped = true;
    clearTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
