import React from "react";
import { Shield, ShieldOff, ShieldCheck, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios.ts";
import type {
  FirewallMetrics,
  FirewallChain,
  FirewallRule,
} from "@/types/stats-widgets";
import { SectionCard } from "@/components/section-card";

interface FirewallWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

function RuleRow({ rule }: { rule: FirewallRule }) {
  const { t } = useTranslation();
  const targetClass =
    rule.target.toUpperCase() === "ACCEPT"
      ? "text-accent-brand"
      : rule.target.toUpperCase() === "DROP"
        ? "text-destructive"
        : rule.target.toUpperCase() === "REJECT"
          ? "text-yellow-500"
          : "text-muted-foreground";

  const src =
    rule.interface ??
    rule.state ??
    (rule.source === "0.0.0.0/0"
      ? t("serverStats.firewall.anywhere")
      : rule.source);

  return (
    <div className="grid grid-cols-4 gap-2 text-xs font-mono py-1 border-b border-border/50 last:border-0">
      <span className={`font-bold ${targetClass}`}>{rule.target}</span>
      <span className="text-muted-foreground">
        {rule.protocol.toUpperCase()}
      </span>
      <span>{rule.dport ?? "—"}</span>
      <span className="truncate text-muted-foreground" title={src}>
        {src}
      </span>
    </div>
  );
}

function ChainSection({ chain }: { chain: FirewallChain }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(true);
  const policyClass =
    chain.policy.toUpperCase() === "ACCEPT"
      ? "text-accent-brand"
      : chain.policy.toUpperCase() === "DROP"
        ? "text-destructive"
        : "text-yellow-500";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full py-1.5 hover:bg-muted/30 text-left"
      >
        <ChevronDown
          className={`size-3 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span className="text-xs font-bold">{chain.name}</span>
        <span className="text-[10px] text-muted-foreground">
          ({t("serverStats.firewall.policy")}:{" "}
          <span className={policyClass}>{chain.policy}</span>)
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {chain.rules.length} {t("serverStats.firewall.rules")}
        </span>
      </button>
      {open && chain.rules.length > 0 && (
        <div className="ml-5">
          <div className="grid grid-cols-4 gap-2 text-[10px] text-muted-foreground font-bold uppercase pb-1 border-b border-border">
            <span>{t("serverStats.firewall.action")}</span>
            <span>{t("serverStats.firewall.protocol")}</span>
            <span>{t("serverStats.firewall.port")}</span>
            <span>{t("serverStats.firewall.source")}</span>
          </div>
          {chain.rules.map((rule, i) => (
            <RuleRow key={i} rule={rule} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FirewallWidget({ metrics }: FirewallWidgetProps) {
  const { t } = useTranslation();
  const firewall = (metrics as ServerMetrics & { firewall?: FirewallMetrics })
    ?.firewall;

  const statusIcon =
    !firewall || firewall.type === "none" ? (
      <ShieldOff className="size-3.5 text-muted-foreground" />
    ) : firewall.status === "active" ? (
      <ShieldCheck className="size-3.5 text-accent-brand" />
    ) : (
      <Shield className="size-3.5 text-yellow-500" />
    );

  const statusBadge =
    firewall?.status === "active" ? (
      <span className="flex items-center gap-1.5 px-2 py-0.5 border border-accent-brand/40 bg-accent-brand/10 text-accent-brand text-[10px] font-bold">
        <ShieldCheck className="size-3" /> ACTIVE
      </span>
    ) : (
      <span className="flex items-center gap-1.5 px-2 py-0.5 border border-border text-muted-foreground text-[10px] font-bold">
        {t("serverStats.firewall.inactive").toUpperCase()}
      </span>
    );

  return (
    <SectionCard title={t("serverStats.firewall.title")} icon={statusIcon}>
      <div className="flex flex-col gap-3 py-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            {t("serverStats.firewall.title")}
          </span>
          {statusBadge}
        </div>
        {firewall?.type && firewall.type !== "none" && (
          <span className="text-[10px] text-muted-foreground uppercase font-bold">
            {firewall.type}
          </span>
        )}
        {firewall && firewall.chains.length > 0 ? (
          <div className="flex flex-col gap-1 overflow-y-auto max-h-[320px]">
            {firewall.chains.map((chain) => (
              <ChainSection key={chain.name} chain={chain} />
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("serverStats.firewall.noData")}
          </span>
        )}
      </div>
    </SectionCard>
  );
}
