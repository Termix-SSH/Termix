import { UserCheck, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/section-card";

interface LoginRecord {
  user: string;
  ip: string;
  time: string;
  status: "success" | "failed";
}

interface LoginStatsMetrics {
  recentLogins: LoginRecord[];
  failedLogins: LoginRecord[];
  totalLogins: number;
  uniqueIPs: number;
}

interface LoginStatsWidgetProps {
  metrics: { login_stats?: LoginStatsMetrics } | null;
  metricsHistory: unknown[];
}

export function LoginStatsWidget({ metrics }: LoginStatsWidgetProps) {
  const { t } = useTranslation();

  const loginStats = metrics?.login_stats;
  const recentLogins = loginStats?.recentLogins ?? [];
  const failedLogins = loginStats?.failedLogins ?? [];

  const allLogins = [
    ...recentLogins.map((l) => ({ ...l, status: "success" as const })),
    ...failedLogins.map((l) => ({ ...l, status: "failed" as const })),
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 6);

  return (
    <SectionCard
      title={t("serverStats.loginStats")}
      icon={<UserCheck className="size-3.5" />}
    >
      <div className="flex flex-col gap-2 py-1">
        {allLogins.length === 0 ? (
          <span className="text-xs text-muted-foreground italic py-2">
            {t("serverStats.noRecentLoginData")}
          </span>
        ) : (
          <div className="flex flex-col gap-2 overflow-y-auto max-h-[300px]">
            {allLogins.map((login, i) => (
              <div
                key={i}
                className={`flex items-center justify-between p-2 border ${login.status === "success" ? "border-border bg-muted/30" : "border-destructive/30 bg-destructive/5"}`}
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    {login.status === "failed" ? (
                      <UserX className="size-3 text-destructive" />
                    ) : (
                      <UserCheck className="size-3 text-accent-brand" />
                    )}
                    <span
                      className={`text-xs font-bold ${login.status === "failed" ? "text-destructive" : ""}`}
                    >
                      {login.user}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {login.ip}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`text-[9px] font-bold uppercase px-1.5 py-px border ${login.status === "success" ? "border-accent-brand/40 text-accent-brand bg-accent-brand/10" : "border-destructive/40 text-destructive"}`}
                  >
                    {login.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(login.time).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
