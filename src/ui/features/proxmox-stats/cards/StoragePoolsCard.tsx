import { Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProxmoxStatsSnapshot } from "@/types/proxmox";
import { MetricCard } from "@/features/host-metrics/cards/MetricCard";

export function StoragePoolsCard({
  snapshot,
}: {
  snapshot: ProxmoxStatsSnapshot | null;
}) {
  const { t } = useTranslation();
  const pools = snapshot?.storage.pools ?? [];

  return (
    <MetricCard
      title={t("proxmoxStats.storagePools")}
      icon={<Database className="size-3.5" />}
      scroll
    >
      {pools.length === 0 ? (
        <span className="text-xs text-muted-foreground">N/A</span>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {pools.map((pool) => (
            <div key={pool.name} className="flex flex-col gap-1 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {pool.name}
                </span>
                <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {pool.type}
                </span>
                {!pool.active && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t("proxmoxStats.inactive")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-accent-brand"
                    style={{
                      width: `${Math.min(100, Math.max(0, pool.percent ?? 0))}%`,
                    }}
                  />
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {pool.usedGiB !== null && pool.totalGiB !== null
                    ? `${pool.usedGiB.toFixed(1)} / ${pool.totalGiB.toFixed(1)} GiB`
                    : "N/A"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </MetricCard>
  );
}
