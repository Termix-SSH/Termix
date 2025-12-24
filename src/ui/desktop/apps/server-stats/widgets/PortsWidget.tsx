import React from "react";
import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";
import type { PortsMetrics, ListeningPort } from "@/types/stats-widgets";

interface PortsWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

function PortRow({ port }: { port: ListeningPort }) {
  const formatAddress = (addr: string) => {
    if (addr === "0.0.0.0" || addr === "*" || addr === "::") {
      return "*";
    }
    return addr;
  };

  return (
    <div className="grid grid-cols-5 gap-2 text-xs py-1.5 border-b border-edge/30 last:border-0">
      <div className="font-mono text-foreground-subtle">
        {port.protocol.toUpperCase()}
      </div>
      <div className="font-mono text-foreground">
        {port.localPort}
      </div>
      <div className="font-mono text-foreground-subtle truncate" title={formatAddress(port.localAddress)}>
        {formatAddress(port.localAddress)}
      </div>
      <div className="text-foreground-subtle">
        {port.state || "-"}
      </div>
      <div className="text-foreground-subtle truncate" title={port.process || "-"}>
        {port.process || (port.pid ? `PID:${port.pid}` : "-")}
      </div>
    </div>
  );
}

export function PortsWidget({ metrics }: PortsWidgetProps) {
  const { t } = useTranslation();

  const portsData = (
    metrics as ServerMetrics & { ports?: PortsMetrics }
  )?.ports;

  const tcpPorts = portsData?.ports.filter(p => p.protocol === "tcp") || [];
  const udpPorts = portsData?.ports.filter(p => p.protocol === "udp") || [];

  return (
    <div className="h-full w-full p-4 rounded-lg bg-canvas/50 border border-edge/50 hover:bg-canvas/70 transition-colors duration-200 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        <Network className="h-5 w-5 text-cyan-400" />
        <h3 className="font-semibold text-lg text-foreground">
          {t("serverStats.ports.title")}
        </h3>
        {portsData && portsData.source !== "none" && (
          <span className="text-xs text-muted-foreground ml-auto bg-canvas/50 px-2 py-0.5 rounded">
            {portsData.source}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 mb-3 flex-shrink-0 text-sm">
        <span className="text-foreground-subtle">
          TCP: <span className="text-cyan-400 font-medium">{tcpPorts.length}</span>
        </span>
        <span className="text-foreground-subtle">
          UDP: <span className="text-cyan-400 font-medium">{udpPorts.length}</span>
        </span>
      </div>

      {portsData && portsData.ports.length > 0 ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="grid grid-cols-5 gap-2 text-xs text-muted-foreground border-b border-edge/50 pb-1 mb-1 flex-shrink-0">
            <div>{t("serverStats.ports.protocol")}</div>
            <div>{t("serverStats.ports.port")}</div>
            <div>{t("serverStats.ports.address")}</div>
            <div>{t("serverStats.ports.state")}</div>
            <div>{t("serverStats.ports.process")}</div>
          </div>
          <div className="flex-1 overflow-y-auto thin-scrollbar">
            {portsData.ports.map((port, idx) => (
              <PortRow key={`${port.protocol}-${port.localPort}-${idx}`} port={port} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {t("serverStats.ports.noData")}
          </p>
        </div>
      )}
    </div>
  );
}
