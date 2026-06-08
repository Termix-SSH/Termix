import { Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics, ListeningPort } from "@/main-axios";
import { MetricCard } from "./MetricCard";

function formatAddress(addr: string) {
  return addr === "0.0.0.0" || addr === "*" || addr === "::" ? "*" : addr;
}

function PortRow({ port }: { port: ListeningPort }) {
  return (
    <div className="grid grid-cols-[3.5rem_3rem_1fr_4rem] gap-2 overflow-hidden border-b border-border/50 py-1 font-mono text-xs last:border-0">
      <span className="truncate font-bold text-accent-brand">
        {port.localPort}
      </span>
      <span className="truncate text-muted-foreground">
        {port.protocol.toUpperCase()}
      </span>
      <span className="truncate font-semibold">
        {port.process ?? (port.pid ? `PID:${port.pid}` : "—")}
      </span>
      <span className="truncate text-right text-muted-foreground">
        {formatAddress(port.localAddress)}
      </span>
    </div>
  );
}

export function PortsCard({ metrics }: { metrics: ServerMetrics | null }) {
  const { t } = useTranslation();
  const ports = metrics?.ports?.ports ?? [];

  return (
    <MetricCard
      title={t("hostMetrics.ports.title")}
      icon={<Unplug className="size-3.5" />}
      scroll
    >
      <div className="flex flex-col">
        <div className="grid grid-cols-[3.5rem_3rem_1fr_4rem] gap-2 border-b border-border pb-1 text-[10px] font-bold uppercase text-muted-foreground">
          <span>{t("hostMetrics.ports.port")}</span>
          <span>{t("hostMetrics.ports.protocol")}</span>
          <span>{t("hostMetrics.ports.process")}</span>
          <span className="text-right">{t("hostMetrics.ports.address")}</span>
        </div>
        {ports.length === 0 ? (
          <span className="py-2 text-xs italic text-muted-foreground">
            {t("hostMetrics.ports.noData")}
          </span>
        ) : (
          ports.map((port, i) => (
            <PortRow
              key={`${port.protocol}-${port.localPort}-${i}`}
              port={port}
            />
          ))
        )}
      </div>
    </MetricCard>
  );
}
