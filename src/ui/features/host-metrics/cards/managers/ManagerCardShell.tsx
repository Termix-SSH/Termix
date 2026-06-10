import type { ReactNode } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { MetricCard } from "../MetricCard";
import type { ManagerError } from "./useManagerData";

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
            title={t("hostMetrics.refresh")}
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
              {t("hostMetrics.managers.sudoHint")}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="mt-1"
          >
            {t("hostMetrics.retry")}
          </Button>
        </div>
      ) : empty ? (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
          {emptyMessage ?? t("hostMetrics.managers.noData")}
        </div>
      ) : (
        children
      )}
    </MetricCard>
  );
}
