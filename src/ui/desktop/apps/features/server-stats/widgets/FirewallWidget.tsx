import React from "react";
import { Shield, ShieldOff, ShieldCheck, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";
import type {
  FirewallMetrics,
  FirewallChain,
  FirewallRule,
} from "@/types/stats-widgets";

interface FirewallWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

function RuleRow({ rule }: { rule: FirewallRule }) {
  const { t } = useTranslation();

  const getTargetStyle = (target: string) => {
    switch (target.toUpperCase()) {
      case "ACCEPT":
        return "text-green-400";
      case "DROP":
        return "text-red-400";
      case "REJECT":
        return "text-orange-400";
      default:
        return "text-muted-foreground";
    }
  };

  const getTargetLabel = (target: string) => {
    switch (target.toUpperCase()) {
      case "ACCEPT":
        return t("serverStats.firewall.accept");
      case "DROP":
        return t("serverStats.firewall.drop");
      case "REJECT":
        return t("serverStats.firewall.reject");
      default:
        return target;
    }
  };

  const formatSource = () => {
    if (rule.interface) {
      return rule.interface;
    }
    if (rule.state) {
      return rule.state;
    }
    if (rule.source === "0.0.0.0/0") {
      return t("serverStats.firewall.anywhere");
    }
    return rule.source;
  };

  return (
    <div className="grid grid-cols-4 gap-2 text-xs py-1.5 border-b border-edge/30 last:border-0">
      <div className={`font-medium ${getTargetStyle(rule.target)}`}>
        {getTargetLabel(rule.target)}
      </div>
      <div className="text-foreground-subtle font-mono">
        {rule.protocol.toUpperCase()}
      </div>
      <div className="text-foreground-subtle font-mono">
        {rule.dport || "-"}
      </div>
      <div className="text-foreground-subtle truncate" title={formatSource()}>
        {formatSource()}
      </div>
    </div>
  );
}

function ChainSection({ chain }: { chain: FirewallChain }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(true);

  const getPolicyStyle = (policy: string) => {
    switch (policy.toUpperCase()) {
      case "ACCEPT":
        return "text-green-400";
      case "DROP":
        return "text-red-400";
      case "REJECT":
        return "text-orange-400";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full py-1.5 hover:bg-elevated/30 rounded px-1 -mx-1 text-left"
      >
        <ChevronDown
          className={`h-3 w-3 text-muted-foreground transition-transform ${
            isOpen ? "" : "-rotate-90"
          }`}
        />
        <span className="text-sm font-medium text-foreground">
          {chain.name}
        </span>
        <span className="text-xs text-muted-foreground">
          ({t("serverStats.firewall.policy")}:{" "}
          <span className={getPolicyStyle(chain.policy)}>{chain.policy}</span>)
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {chain.rules.length} {t("serverStats.firewall.rules")}
        </span>
      </button>
      {isOpen && (
        <>
          {chain.rules.length > 0 ? (
            <div className="mt-2 ml-5">
              <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground border-b border-edge/50 pb-1 mb-1">
                <div>{t("serverStats.firewall.action")}</div>
                <div>{t("serverStats.firewall.protocol")}</div>
                <div>{t("serverStats.firewall.port")}</div>
                <div>{t("serverStats.firewall.source")}</div>
              </div>
              <div className="max-h-32 overflow-y-auto thin-scrollbar">
                {chain.rules.map((rule, idx) => (
                  <RuleRow key={idx} rule={rule} />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground ml-5 mt-1">
              {t("serverStats.firewall.noRules")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function FirewallWidget({ metrics }: FirewallWidgetProps) {
  const { t } = useTranslation();

  const firewall = (metrics as ServerMetrics & { firewall?: FirewallMetrics })
    ?.firewall;

  const getStatusIcon = () => {
    if (!firewall || firewall.type === "none") {
      return <ShieldOff className="h-5 w-5 text-muted-foreground" />;
    }
    if (firewall.status === "active") {
      return <ShieldCheck className="h-5 w-5 text-green-400" />;
    }
    return <Shield className="h-5 w-5 text-orange-400" />;
  };

  const getStatusText = () => {
    if (!firewall || firewall.type === "none") {
      return t("serverStats.firewall.notDetected");
    }
    if (firewall.status === "active") {
      return t("serverStats.firewall.active");
    }
    return t("serverStats.firewall.inactive");
  };

  return (
    <div className="h-full w-full p-4 rounded-lg bg-elevated border border-edge/50 hover:bg-elevated/70 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        {getStatusIcon()}
        <h3 className="font-semibold text-lg text-foreground">
          {t("serverStats.firewall.title")}
        </h3>
        {firewall && firewall.type !== "none" && (
          <span className="text-xs text-muted-foreground ml-auto bg-elevated/50 px-2 py-0.5 rounded capitalize">
            {firewall.type}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <span
          className={`text-sm font-medium ${
            firewall?.status === "active"
              ? "text-green-400"
              : firewall?.status === "inactive"
                ? "text-orange-400"
                : "text-muted-foreground"
          }`}
        >
          {getStatusText()}
        </span>
      </div>

      {firewall && firewall.chains.length > 0 ? (
        <div className="flex-1 overflow-y-auto thin-scrollbar space-y-2">
          {firewall.chains.map((chain) => (
            <ChainSection key={chain.name} chain={chain} />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {t("serverStats.firewall.noData")}
          </p>
        </div>
      )}
    </div>
  );
}
