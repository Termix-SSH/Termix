import { useMemo } from "react";
import { HeartPulse, CheckCircle2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sparkline } from "@/components/charts";
import { useManagerData } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";

interface HealthCheck {
  id: string;
  name: string;
  type: "tcp" | "http";
  target: string;
  port?: number;
}
interface HealthResult {
  checkId: string;
  ok: boolean;
  latencyMs: number | null;
  detail: string;
}
interface HistoryRow {
  checkId: string;
  ts: string;
  ok: boolean;
  latencyMs: number | null;
}
interface HealthData {
  checks: HealthCheck[];
  results: HealthResult[];
  history: HistoryRow[];
}

export function HealthCheckCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<HealthData>(
    hostId,
    "health",
  );

  const byCheck = useMemo(() => {
    const map = new Map<string, HistoryRow[]>();
    for (const h of data?.history ?? []) {
      const arr = map.get(h.checkId) ?? [];
      arr.push(h);
      map.set(h.checkId, arr);
    }
    return map;
  }, [data?.history]);

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.healthCheck")}
      icon={<HeartPulse className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && (data?.checks?.length ?? 0) === 0}
      emptyMessage={t("hostMetrics.managers.noHealthChecks")}
    >
      <div className="flex flex-col gap-3">
        {(data?.checks ?? []).map((check) => {
          const result = data?.results?.find((r) => r.checkId === check.id);
          const hist = (byCheck.get(check.id) ?? []).slice().reverse();
          const upPct =
            hist.length > 0
              ? Math.round(
                  (hist.filter((h) => h.ok).length / hist.length) * 100,
                )
              : null;
          return (
            <div
              key={check.id}
              className="flex flex-col gap-1 border border-border bg-muted/20 p-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {result?.ok ? (
                    <CheckCircle2 className="size-3.5 text-accent-brand" />
                  ) : (
                    <XCircle className="size-3.5 text-destructive" />
                  )}
                  <span className="text-xs font-semibold">{check.name}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {result?.latencyMs != null ? `${result.latencyMs}ms` : "—"}
                  {upPct != null ? ` · ${upPct}%` : ""}
                </span>
              </div>
              {hist.length > 1 && (
                <Sparkline
                  data={hist.map((h) => h.latencyMs ?? 0)}
                  height={28}
                  showLastDot={false}
                />
              )}
            </div>
          );
        })}
      </div>
    </ManagerCardShell>
  );
}
