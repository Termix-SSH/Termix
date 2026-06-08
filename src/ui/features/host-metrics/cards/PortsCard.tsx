import { useMemo, useState } from "react";
import { Unplug, Search } from "lucide-react";
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
  const [query, setQuery] = useState("");
  const [proto, setProto] = useState<"all" | "tcp" | "udp">("all");
  const ports = useMemo(() => metrics?.ports?.ports ?? [], [metrics]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return ports.filter((p) => {
      if (proto !== "all" && p.protocol.toLowerCase() !== proto) return false;
      if (!q) return true;
      return (
        String(p.localPort).includes(q) ||
        (p.process ?? "").toLowerCase().includes(q) ||
        String(p.pid ?? "").includes(q) ||
        p.localAddress.toLowerCase().includes(q)
      );
    });
  }, [ports, query, proto]);

  return (
    <MetricCard
      title={t("hostMetrics.ports.title")}
      icon={<Unplug className="size-3.5" />}
      scroll
    >
      <div className="mb-2 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("hostMetrics.ports.search")}
            className="h-7 w-full border border-border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={proto}
          onChange={(e) => setProto(e.target.value as "all" | "tcp" | "udp")}
          className="h-7 border border-border bg-background px-1 text-xs"
        >
          <option value="all">{t("hostMetrics.ports.allProtocols")}</option>
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
        </select>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {filtered.length}
        </span>
      </div>
      <div className="flex flex-col">
        <div className="grid grid-cols-[3.5rem_3rem_1fr_4rem] gap-2 border-b border-border pb-1 text-[10px] font-bold uppercase text-muted-foreground">
          <span>{t("hostMetrics.ports.port")}</span>
          <span>{t("hostMetrics.ports.protocol")}</span>
          <span>{t("hostMetrics.ports.process")}</span>
          <span className="text-right">{t("hostMetrics.ports.address")}</span>
        </div>
        {filtered.length === 0 ? (
          <span className="py-2 text-xs italic text-muted-foreground">
            {t("hostMetrics.ports.noData")}
          </span>
        ) : (
          filtered.map((port, i) => (
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
