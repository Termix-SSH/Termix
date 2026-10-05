import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/button.tsx";
import { RefreshCw } from "lucide-react";
import { ConnectionLogPanel } from "@/components/connection/ConnectionLogPanel.tsx";
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
  /** Headline once it has failed and is not retrying on its own. */
  errorMessage?: string;
  /** The reason it failed, shown under the headline. */
  errorDetail?: string | null;
  /** Shown instead of a failure when the feature cannot run here. */
  unavailable?: ConnectionUnavailable | null;
  backgroundColor?: string;
  attempt?: number;
  maxAttempts?: number;
  nextRetryInMs?: number | null;
  onManualRetry?: () => void;
  retryLabel?: string;
  disconnectedMessage?: string;
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
  errorMessage,
  errorDetail,
  unavailable,
  backgroundColor,
  attempt = 0,
  maxAttempts = 0,
  nextRetryInMs = null,
  onManualRetry,
  retryLabel,
  disconnectedMessage,
  extraActions,
  logPosition = "bottom",
  emptyState,
  className,
}: ConnectionScreenProps) {
  const { t } = useTranslation();

  if (status === "connected" && !emptyState && !unavailable) {
    return null;
  }

  const connecting = status === "connecting" && !unavailable;
  const failed = status === "error" || status === "disconnected";
  const retrying =
    status === "error" && attempt > 0 && !!nextRetryInMs && nextRetryInMs > 0;
  const showRetryButton = (failed || !!unavailable) && !!onManualRetry;
  const showLog = !emptyState && (status !== "connected" || !!unavailable);

  let headline = message;
  if (unavailable) headline = unavailable.title;
  else if (status === "disconnected")
    headline = disconnectedMessage || t("connection.disconnected");
  else if (retrying) headline = t("connection.failedRetrying");
  else if (status === "error")
    headline = errorMessage || t("connection.failed");

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
              {failed && !unavailable && errorDetail && (
                <p className="line-clamp-3 text-xs leading-snug text-destructive/80">
                  {errorDetail}
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
              ((failed || unavailable) && extraActions) ||
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
                      : retryLabel || t("connection.reconnect")}
                  </Button>
                )}
                {unavailable?.action}
                {(failed || unavailable) && extraActions}
              </div>
            )}
          </div>
        )}
      </div>

      {showLog && (
        <ConnectionLogPanel
          isConnecting={connecting}
          isConnected={false}
          hasConnectionError={failed || !!unavailable}
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
