import { Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios.ts";
import type { PortsMetrics, ListeningPort } from "@/types/stats-widgets";
import { SectionCard } from "@/components/section-card";

interface PortsWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

function PortRow({ port }: { port: ListeningPort }) {
  const formatAddress = (addr: string) =>
    addr === "0.0.0.0" || addr === "*" || addr === "::" ? "*" : addr;

  return (
    <div className="grid grid-cols-4 text-xs font-mono py-1 border-b border-border/50 last:border-0 min-w-0 overflow-hidden">
      <span className="text-accent-brand font-bold truncate">
        {port.localPort}
      </span>
      <span className="text-muted-foreground truncate">
        {port.protocol.toUpperCase()}
      </span>
      <span className="font-semibold truncate">
        {port.process ?? (port.pid ? `PID:${port.pid}` : "—")}
      </span>
      <span className="text-right text-muted-foreground truncate">
        {formatAddress(port.localAddress)}
      </span>
    </div>
  );
}

export function PortsWidget({ metrics }: PortsWidgetProps) {
  const { t } = useTranslation();

  const portsData = (metrics as ServerMetrics & { ports?: PortsMetrics })
    ?.ports;
  const ports = portsData?.ports ?? [];

  return (
    <SectionCard
      title={t("serverStats.ports.title")}
      icon={<Unplug className="size-3.5" />}
    >
      <div className="flex flex-col gap-1.5 py-1 overflow-x-hidden">
        <div className="grid grid-cols-4 text-[10px] text-muted-foreground font-bold uppercase pb-1 border-b border-border min-w-0">
          <span>{t("serverStats.ports.port")}</span>
          <span>{t("serverStats.ports.protocol")}</span>
          <span>{t("serverStats.ports.process")}</span>
          <span className="text-right">{t("serverStats.ports.address")}</span>
        </div>
        {ports.length === 0 ? (
          <span className="text-xs text-muted-foreground italic py-2">
            {t("serverStats.ports.noData")}
          </span>
        ) : (
          <div className="overflow-y-auto max-h-[300px]">
            {ports.map((port, i) => (
              <PortRow
                key={`${port.protocol}-${port.localPort}-${i}`}
                port={port}
              />
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
