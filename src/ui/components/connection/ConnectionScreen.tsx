import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/button.tsx";
import { RefreshCw } from "lucide-react";
import { ConnectionLogPanel } from "@/components/connection/ConnectionLogPanel.tsx";
import type { ConnectionStatus } from "@/components/connection/connection-status.ts";

interface ConnectionScreenProps {
  status: ConnectionStatus;
  message?: string;
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

export function ConnectionScreen({
  status,
  message,
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

  if (status === "connected" && !emptyState) {
    return null;
  }

  const showSpinner = status === "connecting";
  const showRetryButton = status === "disconnected" && !!onManualRetry;
  const showLog = status !== "connected";

  return (
    <div
      role="status"
      aria-live="polite"
      data-status={status}
      className={cn(
        "motion-context-enter absolute inset-0 z-[100] flex flex-col",
        className,
      )}
      style={{ backgroundColor: backgroundColor || "var(--bg-base)" }}
    >
      <div className="flex-1 min-h-0 flex items-center justify-center">
        {emptyState ? (
          emptyState
        ) : (
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            {showSpinner && (
              <div
                className="connection-signal"
                data-active="true"
                aria-hidden="true"
              >
                <span className="connection-signal-core" />
              </div>
            )}
            {message && (
              <p className="text-sm text-foreground-secondary font-medium">
                {message}
              </p>
            )}
            {attempt > 0 && status !== "disconnected" && (
              <p className="text-xs text-muted-foreground">
                {nextRetryInMs && nextRetryInMs > 0
                  ? t("connection.retryingIn", {
                      seconds: Math.ceil(nextRetryInMs / 1000),
                      attempt,
                      max: maxAttempts,
                    })
                  : t("connection.retryingNow", { attempt, max: maxAttempts })}
              </p>
            )}
            {showRetryButton && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-foreground-secondary font-medium">
                  {disconnectedMessage || t("connection.disconnected")}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="default"
                    onClick={onManualRetry}
                    className="gap-2 font-semibold"
                  >
                    <RefreshCw className="size-3.5" />
                    {retryLabel || t("connection.reconnect")}
                  </Button>
                  {extraActions}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showLog && !emptyState && (
        <ConnectionLogPanel
          isConnecting={status === "connecting"}
          isConnected={false}
          hasConnectionError={status === "error" || status === "disconnected"}
          position={logPosition}
        />
      )}
    </div>
  );
}
