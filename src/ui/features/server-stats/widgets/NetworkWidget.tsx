import { Network, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios.ts";
import { SectionCard } from "@/components/section-card";

interface NetworkWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function NetworkWidget({ metrics }: NetworkWidgetProps) {
  const { t } = useTranslation();

  const metricsWithNetwork = metrics as ServerMetrics & {
    network?: {
      interfaces?: Array<{
        name: string;
        state: string;
        ip: string;
        rx?: string;
        tx?: string;
      }>;
    };
  };
  const interfaces = metricsWithNetwork?.network?.interfaces ?? [];

  return (
    <SectionCard
      title={t("serverStats.networkInterfaces")}
      icon={<Network className="size-3.5" />}
    >
      <div className="flex flex-col gap-2 py-1">
        {interfaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
            <WifiOff className="size-6 opacity-40" />
            <span className="text-xs">
              {t("serverStats.noInterfacesFound")}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 overflow-y-auto max-h-[260px]">
            {interfaces.map((iface, i) => (
              <div
                key={i}
                className="flex flex-col p-2 border border-border bg-muted/30 gap-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`size-1.5 rounded-full ${iface.state === "UP" ? "bg-accent-brand" : "bg-muted-foreground"}`}
                    />
                    <span className="text-sm font-bold font-mono">
                      {iface.name}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold px-1.5 py-px border border-border text-muted-foreground uppercase">
                    {iface.state}
                  </span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                  <span>{iface.ip}</span>
                  {(iface.rx || iface.tx) && (
                    <span>
                      ↓ {iface.rx ?? "—"} / ↑ {iface.tx ?? "—"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
