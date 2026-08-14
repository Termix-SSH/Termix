import { useEffect, useRef } from "react";
import {
  runAdaptivePolling,
  type AdaptivePollResult,
  type AdaptivePollingPolicy,
} from "@/lib/adaptive-polling.ts";

export function useAdaptivePolling(
  poll: () => AdaptivePollResult | Promise<AdaptivePollResult>,
  policy: AdaptivePollingPolicy,
  enabled = true,
  options: {
    runImmediately?: boolean;
    onError?: (error: unknown) => void;
  } = {},
): void {
  const pollRef = useRef(poll);
  const errorRef = useRef(options.onError);
  pollRef.current = poll;
  errorRef.current = options.onError;
  const { minIntervalMs, maxIntervalMs, stablePollsPerStep, jitterRatio } =
    policy;
  const runImmediately = options.runImmediately;

  useEffect(
    () =>
      runAdaptivePolling(
        () => pollRef.current(),
        {
          minIntervalMs,
          maxIntervalMs,
          stablePollsPerStep,
          jitterRatio,
        },
        {
          enabled: () => enabled,
          runImmediately,
          onError: (error) => errorRef.current?.(error),
        },
      ),
    [
      enabled,
      jitterRatio,
      maxIntervalMs,
      minIntervalMs,
      runImmediately,
      stablePollsPerStep,
    ],
  );
}
