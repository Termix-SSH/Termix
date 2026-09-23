import type { ReactNode } from "react";
import { RefreshCw, AlertTriangle, Search } from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button } from "@/components/button";
import { MetricCard } from "@/components/metric-card";
import type { ManagerError } from "./useTailscaleManager";

/**
 * Local copy of host-metrics' ManagerCardShell, kept in step with it by eye.
 * A shared component belongs in the SDK once a second plugin needs it.
 */
export function TailscaleManagerShell({
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
  error: ManagerError | null;
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
            title={t("manager.refresh")}
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
              {t("manager.sudoHint")}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="mt-1"
          >
            {t("manager.retry")}
          </Button>
        </div>
      ) : empty ? (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
          {emptyMessage ?? t("manager.noData")}
        </div>
      ) : (
        children
      )}
    </MetricCard>
  );
}

/** Local copy of host-metrics' ManagerSearch. */
export function TailscaleManagerSearch({
  value,
  onChange,
  count,
}: {
  value: string;
  onChange: (v: string) => void;
  count?: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("manager.filter")}
          className="h-7 w-full border border-border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {count != null && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  );
}
