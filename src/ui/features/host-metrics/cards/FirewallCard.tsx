import { useState } from "react";
import { Shield, ShieldOff, ShieldCheck, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics, FirewallChain, FirewallRule } from "@/main-axios";
import { cn } from "@/lib/utils";
import { MetricCard } from "./MetricCard";

function targetClass(target: string) {
  const t = target.toUpperCase();
  if (t === "ACCEPT") return "text-accent-brand";
  if (t === "DROP") return "text-destructive";
  if (t === "REJECT") return "text-yellow-500";
  return "text-muted-foreground";
}

function RuleRow({ rule }: { rule: FirewallRule }) {
  const { t } = useTranslation();
  const src =
    rule.interface ??
    rule.state ??
    (rule.source === "0.0.0.0/0"
      ? t("hostMetrics.firewall.anywhere")
      : rule.source);
  return (
    <div className="grid grid-cols-4 gap-2 border-b border-border/50 py-1 font-mono text-xs last:border-0">
      <span className={cn("font-bold", targetClass(rule.target))}>
        {rule.target}
      </span>
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
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-muted/30"
      >
        <ChevronDown
          className={cn(
            "size-3 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        <span className="text-xs font-bold">{chain.name}</span>
        <span className="text-[10px] text-muted-foreground">
          ({t("hostMetrics.firewall.policy")}:{" "}
          <span className={targetClass(chain.policy)}>{chain.policy}</span>)
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {chain.rules.length} {t("hostMetrics.firewall.rules")}
        </span>
      </button>
      {open && chain.rules.length > 0 && (
        <div className="ml-5">
          <div className="grid grid-cols-4 gap-2 border-b border-border pb-1 text-[10px] font-bold uppercase text-muted-foreground">
            <span>{t("hostMetrics.firewall.action")}</span>
            <span>{t("hostMetrics.firewall.protocol")}</span>
            <span>{t("hostMetrics.firewall.port")}</span>
            <span>{t("hostMetrics.firewall.source")}</span>
          </div>
          {chain.rules.map((rule, i) => (
            <RuleRow key={i} rule={rule} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FirewallCard({ metrics }: { metrics: ServerMetrics | null }) {
  const { t } = useTranslation();
  const firewall = metrics?.firewall;
  const chains = firewall?.chains ?? [];

  const statusIcon =
    !firewall || firewall.type === "none" ? (
      <ShieldOff className="size-3.5 text-muted-foreground" />
    ) : firewall.status === "active" ? (
      <ShieldCheck className="size-3.5 text-accent-brand" />
    ) : (
      <Shield className="size-3.5 text-yellow-500" />
    );

  return (
    <MetricCard
      title={t("hostMetrics.firewall.title")}
      icon={statusIcon}
      scroll
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          {firewall?.type && firewall.type !== "none" ? (
            <span className="text-[10px] font-bold uppercase text-muted-foreground">
              {firewall.type}
            </span>
          ) : (
            <span />
          )}
          {firewall?.status === "active" ? (
            <span className="flex items-center gap-1.5 border border-accent-brand/40 bg-accent-brand/10 px-2 py-0.5 text-[10px] font-bold text-accent-brand">
              <ShieldCheck className="size-3" /> ACTIVE
            </span>
          ) : (
            <span className="border border-border px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {t("hostMetrics.firewall.inactive").toUpperCase()}
            </span>
          )}
        </div>
        {chains.length > 0 ? (
          <div className="flex flex-col gap-1">
            {chains.map((chain) => (
              <ChainSection key={chain.name} chain={chain} />
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("hostMetrics.firewall.noData")}
          </span>
        )}
      </div>
    </MetricCard>
  );
}
