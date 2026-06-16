import { Cable, Container, Network, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { MetricCard } from "./MetricCard";

function ifaceIcon(name: string) {
  if (/^(wl|wlan|wifi|ath)/.test(name))
    return <Wifi className="size-3 text-muted-foreground/60" />;
  if (/^(eth|en|enp|eno|ens)/.test(name))
    return <Cable className="size-3 text-muted-foreground/60" />;
  if (/^(docker|br-|veth|virbr|vlan|bond|tun|tap|wg|lo)/.test(name))
    return <Container className="size-3 text-muted-foreground/60" />;
  return <Network className="size-3 text-muted-foreground/60" />;
}

export function NetworkCard({ metrics }: { metrics: ServerMetrics | null }) {
  const { t } = useTranslation();
  const interfaces = metrics?.network?.interfaces ?? [];

  return (
    <MetricCard
      title={t("hostMetrics.networkInterfaces")}
      icon={<Network className="size-3.5" />}
      scroll
    >
      {interfaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
          <WifiOff className="size-6 opacity-40" />
          <span className="text-xs">{t("hostMetrics.noInterfacesFound")}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {interfaces.map((iface, i) => (
            <div
              key={`${iface.name}-${i}`}
              className="flex flex-col gap-1 border border-border bg-muted/30 p-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {ifaceIcon(iface.name)}
                  <span
                    className={`size-1.5 rounded-full ${iface.state === "UP" ? "bg-accent-brand" : "bg-muted-foreground/50"}`}
                  />
                  <span className="font-mono text-sm font-bold">
                    {iface.name}
                  </span>
                </div>
                <span className="border border-border px-1.5 py-px text-[10px] font-semibold uppercase text-muted-foreground">
                  {iface.state}
                </span>
              </div>
              <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                <span className="truncate">{iface.ip}</span>
                {(iface.rx || iface.tx) && (
                  <span className="shrink-0">
                    ↓ {iface.rx ?? "—"} / ↑ {iface.tx ?? "—"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </MetricCard>
  );
}
