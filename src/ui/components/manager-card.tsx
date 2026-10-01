import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, AlertTriangle, Search } from "lucide-react";
import { Button } from "@/components/button";
import { MetricCard } from "@/components/metric-card";

export interface ManagerCardError {
  message: string;
  code?: string;
}

/** The frame a host manager card draws: title, refresh, error and empty states. */
export function ManagerCardShell({
  title,
  icon,
  loading,
  error,
  onRefresh,
  empty,
  emptyMessage,
  children,
  headerExtra,
}: {
  title: string;
  icon: ReactNode;
  loading: boolean;
  error: ManagerCardError | null;
  onRefresh: () => void;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <MetricCard
      title={title}
      icon={icon}
      scroll
      action={
        <div className="flex items-center gap-1">
          {headerExtra}
          <button
            onClick={onRefresh}
            className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            title={t("managerCard.refresh")}
          >
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      }
    >
      {error ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <AlertTriangle className="size-6 text-yellow-500" />
          <span className="text-xs text-muted-foreground">{error.message}</span>
          {error.code === "SUDO_REQUIRED" && (
            <span className="text-[10px] text-muted-foreground">
              {t("managerCard.sudoHint")}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="mt-1"
          >
            {t("managerCard.retry")}
          </Button>
        </div>
      ) : empty ? (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
          {emptyMessage ?? t("managerCard.noData")}
        </div>
      ) : (
        children
      )}
    </MetricCard>
  );
}

/** The filter box above a manager card's list. */
export function ManagerSearch({
  value,
  onChange,
  placeholder,
  count,
  extra,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  count?: number;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t("managerCard.filter")}
          className="h-7 w-full border border-border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {count != null && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      {extra}
    </div>
  );
}
