import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProxmoxStatsSnapshot } from "@/types/proxmox";
import { StatRow } from "@/components/charts";
import { MetricCard } from "@/features/host-metrics/cards/MetricCard";

export function NodeNetworkCard({
  snapshot,
}: {
  snapshot: ProxmoxStatsSnapshot | null;
}) {
  const { t } = useTranslation();
  const interfaces = snapshot?.network.interfaces ?? [];

  return (
    <MetricCard
      title={t("proxmoxStats.networkInterfaces")}
      icon={<Network className="size-3.5" />}
      scroll
    >
      {interfaces.length === 0 ? (
        <span className="text-xs text-muted-foreground">N/A</span>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {interfaces.map((iface) => (
            <StatRow
              key={iface.name}
              label={iface.name}
              value={iface.ip ?? iface.state ?? "-"}
              mono
            />
          ))}
        </div>
      )}
    </MetricCard>
  );
}
