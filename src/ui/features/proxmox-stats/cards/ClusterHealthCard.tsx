import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProxmoxStatsSnapshot } from "@/types/proxmox";
import { cn } from "@/lib/utils";
import { MetricCard } from "@/features/host-metrics/cards/MetricCard";

export function ClusterHealthCard({
  snapshot,
}: {
  snapshot: ProxmoxStatsSnapshot | null;
}) {
  const { t } = useTranslation();
  const cluster = snapshot?.cluster;

  return (
    <MetricCard
      title={t("proxmoxStats.clusterHealth")}
      icon={<Network className="size-3.5" />}
      scroll
    >
      {!cluster || !cluster.clustered ? (
        <span className="text-xs text-muted-foreground">
          {t("proxmoxStats.notClustered")}
        </span>
      ) : (
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                cluster.quorate ? "bg-green-500" : "bg-red-500",
              )}
            />
            <span className="font-medium">
              {cluster.clusterName ?? t("proxmoxStats.clusterHealth")}
            </span>
            <span className="text-muted-foreground">
              {cluster.quorate
                ? t("proxmoxStats.quorate")
                : t("proxmoxStats.notQuorate")}
            </span>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {cluster.nodes.map((node) => (
              <div key={node.name} className="flex items-center gap-2 py-1.5">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    node.online ? "bg-green-500" : "bg-muted-foreground/50",
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {node.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {node.online
                    ? t("proxmoxStats.nodeOnline")
                    : t("proxmoxStats.nodeOffline")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </MetricCard>
  );
}
