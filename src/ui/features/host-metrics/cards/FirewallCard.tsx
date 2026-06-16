import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { MetricCard } from "./MetricCard";

export function FirewallCard({ metrics }: { metrics: ServerMetrics | null }) {
  const { t } = useTranslation();
  const fw = metrics?.firewall;

  const totalRules =
    fw?.chains?.reduce((sum, c) => sum + (c.rules?.length ?? 0), 0) ?? 0;

  return (
    <MetricCard
      title={t("hostMetrics.firewall.title")}
      icon={<ShieldCheck className="size-3.5" />}
    >
      {!fw || fw.type === "none" ? (
        <span className="text-xs text-muted-foreground">
          {t("hostMetrics.firewall.noData")}
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold uppercase tracking-wide ${
                fw.status === "active"
                  ? "text-accent-brand"
                  : "text-muted-foreground"
              }`}
            >
              {fw.status === "inactive"
                ? t("hostMetrics.firewall.inactive")
                : fw.status}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {fw.type}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              <span className="font-bold text-foreground">
                {fw.chains?.length ?? 0}
              </span>{" "}
              {t("hostMetrics.firewall.chains")}
            </span>
            <span>
              <span className="font-bold text-foreground">{totalRules}</span>{" "}
              {t("hostMetrics.firewall.rules")}
            </span>
          </div>
        </div>
      )}
    </MetricCard>
  );
}
