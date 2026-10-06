import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/button.tsx";
import { RefreshCw, X } from "lucide-react";
import { ConnectionLogPanel } from "@/components/connection/ConnectionLogPanel.tsx";
import { useOptionalConnectionLog } from "@/ssh/connection-log/ConnectionLogContext.tsx";
import { useSurfaceClose } from "@/components/surface/surface-scope.tsx";
import type { ConnectionStatus } from "@/components/connection/connection-status.ts";

export interface ConnectionUnavailable {
  title: string;
  hint?: string;
  /** Another way forward, like opening the host editor. */
  action?: React.ReactNode;
}

export interface ConnectionScreenProps {
  status: ConnectionStatus;
  /** Headline while connecting. */
  message?: string;
  /** Second line under the headline, usually user@host:port. */
  detail?: string;
  /** The reason it failed. Falls back to the last error in the log. */
  errorDetail?: string | null;
  /** Shown instead of a failure when the feature cannot run here. */
  unavailable?: ConnectionUnavailable | null;
  backgroundColor?: string;
  attempt?: number;
  maxAttempts?: number;
  nextRetryInMs?: number | null;
  onManualRetry?: () => void;
  /** Headline when it was up and dropped. */
  disconnectedMessage?: string;
  /** Overrides closing the tab this sits in. False hides the button. */
  onClose?: (() => void) | false;
  extraActions?: React.ReactNode;
  logPosition?: "top" | "bottom";
  emptyState?: React.ReactNode;
  className?: string;
}

/** The one screen every connection shows until it is up. */
export function ConnectionScreen({
  status,
  message,
  detail,
  errorDetail,
  unavailable,
  backgroundColor,
  attempt = 0,
  maxAttempts = 0,
  nextRetryInMs = null,
  onManualRetry,
  disconnectedMessage,
  onClose,
  extraActions,
  logPosition = "bottom",
  emptyState,
  className,
}: ConnectionScreenProps) {
  const { t } = useTranslation();
  const surfaceClose = useSurfaceClose();
  const logs = useOptionalConnectionLog()?.logs;
  const close = onClose === false ? null : (onClose ?? surfaceClose);

  if (status === "connected" && !emptyState && !unavailable) {
    return null;
  }

  const connecting = status === "connecting" && !unavailable;
  const failed = status === "error" || status === "disconnected";
  const retrying =
    status === "error" && attempt > 0 && !!nextRetryInMs && nextRetryInMs > 0;
  const stopped = failed || !!unavailable;
  const showRetryButton = stopped && !!onManualRetry;
  const showClose = stopped && !!close;
  const reason =
    errorDetail ||
    [...(logs ?? [])].reverse().find((entry) => entry.type === "error")
      ?.message ||
    null;
  const showLog = !emptyState && (status !== "connected" || !!unavailable);

  let headline = message;
  if (unavailable) headline = unavailable.title;
  else if (retrying) headline = t("connection.failedRetrying");
  else if (status === "disconnected" && disconnectedMessage)
    headline = disconnectedMessage;
  else if (failed) headline = t("connection.failed");

  const showCountdown = attempt > 0 && (connecting || retrying);

  return (
    <div
      role="status"
      aria-live="polite"
      data-status={unavailable ? "unavailable" : status}
      className={cn(
        "motion-context-enter absolute inset-0 z-[100] flex flex-col",
        className,
      )}
      style={{ backgroundColor: backgroundColor || "var(--bg-base)" }}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        {emptyState ? (
          emptyState
        ) : (
          <div className="flex max-w-md flex-col items-center gap-3.5 text-center">
            <ConnectionMark
              state={
                unavailable
                  ? "unavailable"
                  : connecting || retrying
                    ? "busy"
                    : "failed"
              }
            />

            <div className="space-y-1.5">
              {headline && (
                <p className="text-sm font-semibold tracking-tight text-foreground">
                  {headline}
                </p>
              )}
              {detail && (
                <p className="font-mono text-xs text-muted-foreground">
                  {detail}
                </p>
              )}
              {unavailable?.hint && (
                <p className="text-xs leading-snug text-muted-foreground">
                  {unavailable.hint}
                </p>
              )}
              {failed && !unavailable && reason && (
                <p className="line-clamp-3 text-xs leading-snug text-destructive/80">
                  {reason}
                </p>
              )}
              {showCountdown && (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {nextRetryInMs && nextRetryInMs > 0
                    ? t("connection.retryingIn", {
                        seconds: Math.ceil(nextRetryInMs / 1000),
                        attempt,
                        max: maxAttempts,
                      })
                    : t("connection.retryingNow", {
                        attempt,
                        max: maxAttempts,
                      })}
                </p>
              )}
            </div>

            {(showRetryButton ||
              showClose ||
              (stopped && extraActions) ||
              unavailable?.action) && (
              <div className="flex flex-wrap justify-center gap-2 pt-0.5">
                {showRetryButton && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onManualRetry}
                    className="gap-2 font-semibold"
                  >
                    <RefreshCw className="size-3.5" />
                    {retrying
                      ? t("connection.retryNow")
                      : t("connection.reconnect")}
                  </Button>
                )}
                {unavailable?.action}
                {stopped && extraActions}
                {showClose && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={close}
                    className="gap-2 font-semibold"
                  >
                    <X className="size-3.5" />
                    {t("connection.close")}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showLog && (
        <ConnectionLogPanel
          isConnecting={connecting}
          isConnected={false}
          hasConnectionError={stopped}
          position={logPosition}
        />
      )}
    </div>
  );
}

/** A thin arc while working, a still ring with a dot once it stops. */
function ConnectionMark({
  state,
}: {
  state: "busy" | "failed" | "unavailable";
}) {
  return (
    <div className="relative size-9" aria-hidden="true">
      <svg viewBox="0 0 36 36" className="size-full">
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="2"
          className="stroke-border"
        />
        {state === "busy" && (
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="26 68"
            className="origin-center animate-spin stroke-accent-brand [animation-duration:900ms]"
          />
        )}
      </svg>
      {state !== "busy" && (
        <span
          className={cn(
            "absolute inset-0 m-auto size-1.5 rounded-full",
            state === "failed" ? "bg-destructive" : "bg-muted-foreground",
          )}
        />
      )}
    </div>
  );
}
