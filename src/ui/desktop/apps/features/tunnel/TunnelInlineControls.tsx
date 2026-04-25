import { Button } from "@/components/ui/button.tsx";
import type { TunnelStatus } from "@/types/index.js";
import {
  AlertCircle,
  Loader2,
  Play,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";

type TunnelInlineControlsProps = {
  status?: TunnelStatus;
  loading?: boolean;
  onStart?: () => void;
  onStop?: () => void;
  startDisabled?: boolean;
  startDisabledReason?: string;
};

function getStatusKind(status?: TunnelStatus) {
  const value = status?.status?.toUpperCase() || "DISCONNECTED";

  if (value === "CONNECTED") return "connected";
  if (value === "ERROR" || value === "FAILED") return "error";
  if (
    value === "CONNECTING" ||
    value === "DISCONNECTING" ||
    value === "RETRYING" ||
    value === "WAITING"
  ) {
    return "connecting";
  }

  return "disconnected";
}

function getStatusTitle(
  status: TunnelStatus | undefined,
  statusText: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (!status) return statusText;

  const details = [];
  if (status.reason) details.push(status.reason);
  if (status.retryCount && status.maxRetries) {
    details.push(
      t("tunnels.attempt", {
        current: status.retryCount,
        max: status.maxRetries,
      }),
    );
  }
  if (status.nextRetryIn) {
    details.push(
      t("tunnels.nextRetryIn", {
        seconds: status.nextRetryIn,
      }),
    );
  }
  if (status.errorType && !status.reason) details.push(status.errorType);

  return details.length > 0 ? details.join("\n") : statusText;
}

export function TunnelInlineControls({
  status,
  loading = false,
  onStart,
  onStop,
  startDisabled,
  startDisabledReason,
}: TunnelInlineControlsProps) {
  const { t } = useTranslation();
  const kind = getStatusKind(status);
  const isDisconnected = kind === "disconnected";
  const statusText =
    kind === "connected"
      ? t("tunnels.connected")
      : kind === "connecting"
        ? t("tunnels.connecting")
        : kind === "error"
          ? t("tunnels.error")
          : t("tunnels.disconnected");
  const title = getStatusTitle(status, statusText, t);

  const statusClass =
    kind === "connected"
      ? "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20"
      : kind === "connecting"
        ? "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20"
        : kind === "error"
          ? "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20"
          : "text-muted-foreground bg-muted/30 border-border";

  const statusIcon =
    kind === "connected" ? (
      <Wifi className="h-3 w-3" />
    ) : kind === "connecting" ? (
      <Loader2 className="h-3 w-3 animate-spin" />
    ) : kind === "error" ? (
      <AlertCircle className="h-3 w-3" />
    ) : (
      <WifiOff className="h-3 w-3" />
    );

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium ${statusClass}`}
        title={title}
      >
        {statusIcon}
        {statusText}
      </span>
      {loading ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          className="h-8 px-3 text-xs text-muted-foreground border-border"
        >
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          {isDisconnected ? t("tunnels.start") : t("tunnels.stop")}
        </Button>
      ) : isDisconnected ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onStart}
          disabled={startDisabled}
          title={startDisabled ? startDisabledReason : undefined}
          className="h-8 px-3 text-xs text-green-600 dark:text-green-400 border-green-500/30 dark:border-green-400/30 hover:bg-green-500/10 dark:hover:bg-green-400/10 hover:border-green-500/50 dark:hover:border-green-400/50"
        >
          <Play className="h-3 w-3 mr-1" />
          {t("tunnels.start")}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onStop}
          className="h-8 px-3 text-xs text-red-600 dark:text-red-400 border-red-500/30 dark:border-red-400/30 hover:bg-red-500/10 dark:hover:bg-red-400/10 hover:border-red-500/50 dark:hover:border-red-400/50"
        >
          <Square className="h-3 w-3 mr-1" />
          {t("tunnels.stop")}
        </Button>
      )}
    </div>
  );
}
