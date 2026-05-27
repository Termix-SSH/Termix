import { Button } from "@/components/button.tsx";
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
      ? "text-accent-brand border-accent-brand/40 bg-accent-brand/10"
      : kind === "connecting"
        ? "text-blue-400 border-blue-400/40 bg-blue-400/10"
        : kind === "error"
          ? "text-destructive border-destructive/40 bg-destructive/10"
          : "text-muted-foreground border-border bg-muted/30";

  const statusIcon =
    kind === "connected" ? (
      <Wifi className="size-3" />
    ) : kind === "connecting" ? (
      <Loader2 className="size-3 animate-spin" />
    ) : kind === "error" ? (
      <AlertCircle className="size-3" />
    ) : (
      <WifiOff className="size-3" />
    );

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span
        className={`inline-flex h-8 items-center gap-1.5 border px-2 text-[10px] font-bold uppercase tracking-wide ${statusClass}`}
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
          <Loader2 className="size-3 mr-1 animate-spin" />
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
          className="h-8 px-3 text-xs text-accent-brand border-accent-brand/40 hover:bg-accent-brand/10 hover:text-accent-brand"
        >
          <Play className="size-3 mr-1" />
          {t("tunnels.start")}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onStop}
          className="h-8 px-3 text-xs text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
        >
          <Square className="size-3 mr-1" />
          {t("tunnels.stop")}
        </Button>
      )}
    </div>
  );
}
