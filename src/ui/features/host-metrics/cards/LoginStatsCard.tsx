import { UserCheck, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { MetricCard } from "./MetricCard";

export function LoginStatsCard({ metrics }: { metrics: ServerMetrics | null }) {
  const { t } = useTranslation();
  const loginStats = metrics?.login_stats;
  const recentLogins = loginStats?.recentLogins ?? [];
  const failedLogins = loginStats?.failedLogins ?? [];

  const allLogins = [
    ...recentLogins.map((l) => ({ ...l, status: "success" as const })),
    ...failedLogins.map((l) => ({ ...l, status: "failed" as const })),
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 10);

  return (
    <MetricCard
      title={t("hostMetrics.loginStats")}
      icon={<UserCheck className="size-3.5" />}
      scroll
    >
      {allLogins.length === 0 ? (
        <span className="py-2 text-xs italic text-muted-foreground">
          {t("hostMetrics.noRecentLoginData")}
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          {allLogins.map((login, i) => (
            <div
              key={i}
              className={`flex items-center justify-between border p-2 ${login.status === "success" ? "border-border bg-muted/30" : "border-destructive/30 bg-destructive/5"}`}
            >
              <div className="flex min-w-0 flex-col">
                <div className="flex items-center gap-1.5">
                  {login.status === "failed" ? (
                    <UserX className="size-3 shrink-0 text-destructive" />
                  ) : (
                    <UserCheck className="size-3 shrink-0 text-accent-brand" />
                  )}
                  <span
                    className={`truncate text-xs font-bold ${login.status === "failed" ? "text-destructive" : ""}`}
                  >
                    {login.user}
                  </span>
                </div>
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {login.ip}
                </span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {new Date(login.time).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </MetricCard>
  );
}
