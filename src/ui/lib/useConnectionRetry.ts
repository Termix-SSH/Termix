import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "@/components/connection/connection-status.ts";

interface UseConnectionRetryOptions {
  connect: () => void | Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  enabled?: boolean;
  autoStart?: boolean;
}

interface UseConnectionRetryResult {
  status: ConnectionStatus;
  attempt: number;
  maxAttempts: number;
  nextRetryInMs: number | null;
  markConnected: () => void;
  markFailed: () => void;
  retryNow: () => void;
  reset: () => void;
}

const COUNTDOWN_TICK_MS = 250;
const RETRY_JITTER_RATIO = 0.1;

export function computeReconnectDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random = Math.random,
): number {
  const base = Math.min(
    baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)),
    maxDelayMs,
  );
  const jitter = base * RETRY_JITTER_RATIO * (random() * 2 - 1);
  return Math.max(baseDelayMs, Math.min(maxDelayMs, Math.round(base + jitter)));
}

// Backoff curve mirrors Terminal.tsx's proven attemptReconnection(): 2s, 4s,
// 8s, capped at 8s, up to 8 attempts before falling back to a manual retry.
export function useConnectionRetry({
  connect,
  maxAttempts = 8,
  baseDelayMs = 2000,
  maxDelayMs = 8000,
  enabled = true,
  autoStart = true,
}: UseConnectionRetryOptions): UseConnectionRetryResult {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [attempt, setAttempt] = useState(0);
  const [nextRetryInMs, setNextRetryInMs] = useState<number | null>(null);

  const connectRef = useRef(connect);
  connectRef.current = connect;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const attemptRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const isMountedRef = useRef(true);
  const markFailedRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const runConnect = useCallback(() => {
    if (!isMountedRef.current) return;
    setStatus("connecting");
    try {
      void Promise.resolve(connectRef.current()).catch(() => {
        markFailedRef.current();
      });
    } catch {
      markFailedRef.current();
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    if (attemptRef.current >= maxAttempts) {
      setStatus("disconnected");
      setNextRetryInMs(null);
      return;
    }

    attemptRef.current += 1;
    setAttempt(attemptRef.current);

    const delay = computeReconnectDelay(
      attemptRef.current,
      baseDelayMs,
      maxDelayMs,
    );

    let remaining = delay;
    setNextRetryInMs(remaining);
    countdownIntervalRef.current = setInterval(() => {
      remaining = Math.max(0, remaining - COUNTDOWN_TICK_MS);
      setNextRetryInMs(remaining);
    }, COUNTDOWN_TICK_MS);

    retryTimeoutRef.current = setTimeout(() => {
      clearTimers();
      if (!isMountedRef.current || !enabledRef.current) return;
      runConnect();
    }, delay);
  }, [baseDelayMs, maxDelayMs, maxAttempts, clearTimers, runConnect]);

  const markConnected = useCallback(() => {
    clearTimers();
    attemptRef.current = 0;
    setAttempt(0);
    setNextRetryInMs(null);
    if (isMountedRef.current) setStatus("connected");
  }, [clearTimers]);

  const markFailed = useCallback(() => {
    clearTimers();
    if (!isMountedRef.current) return;
    setStatus("error");
    if (enabledRef.current) {
      scheduleRetry();
    } else {
      setNextRetryInMs(null);
    }
  }, [clearTimers, scheduleRetry]);
  markFailedRef.current = markFailed;

  const retryNow = useCallback(() => {
    clearTimers();
    attemptRef.current = 0;
    setAttempt(0);
    setNextRetryInMs(null);
    runConnect();
  }, [clearTimers, runConnect]);

  const reset = useCallback(() => {
    clearTimers();
    attemptRef.current = 0;
    setAttempt(0);
    setNextRetryInMs(null);
    if (isMountedRef.current) setStatus("connecting");
  }, [clearTimers]);

  useEffect(() => {
    isMountedRef.current = true;
    if (autoStart) {
      runConnect();
    }
    return () => {
      isMountedRef.current = false;
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (enabled && status === "error" && !retryTimeoutRef.current) {
      scheduleRetry();
    }
    if (!enabled) {
      clearTimers();
      setNextRetryInMs(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    status,
    attempt,
    maxAttempts,
    nextRetryInMs,
    markConnected,
    markFailed,
    retryNow,
    reset,
  };
}
