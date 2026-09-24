import { useState, useEffect } from "react";
import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  QuickConnectConfig,
  QuickConnectType,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type { SSHHostWithStatus } from "@/main-axios";
import type { TabType } from "@/types/ui-types";
import { WidgetTitle } from "./WidgetTitle";
import { useHostActions } from "@/sidebar/host-contributions";
import { quickConnectTargets } from "../quick-connect-targets";

function statusDotClass(host: SSHHostWithStatus): string {
  if (host.status === "online") return "bg-green-500";
  if (host.status === "offline") return "bg-red-500";
  return "bg-muted-foreground/30";
}

function openTab(host: SSHHostWithStatus, type: QuickConnectType) {
  window.dispatchEvent(
    new CustomEvent("termix:open-tab", {
      detail: { hostId: String(host.id), type: type as TabType },
    }),
  );
}

function QuickConnectWidget({
  widget,
  config,
}: WidgetComponentProps<QuickConnectConfig>) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<SSHHostWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const targets = quickConnectTargets(useHostActions());

  // An empty list means the first tools plugins offer, in their order.
  const types =
    config.connectionTypes.length > 0
      ? config.connectionTypes
      : (targets
          .slice(0, 2)
          .map((target) => target.type) as QuickConnectType[]);

  useEffect(() => {
    getSSHHosts()
      .then((all) => {
        const filtered =
          config.hostIds.length > 0
            ? all.filter((h) => config.hostIds.includes(h.id))
            : all;
        setHosts(filtered);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [config.hostIds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground/60">
        {t("homepage.loading")}
      </div>
    );
  }

  if (hosts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2 text-muted-foreground/60">
        <Zap size={18} />
        <span className="text-xs">{t("homepage.noHosts")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Zap size={11} />} />
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {hosts.map((host) => {
          const availableTypes = types.flatMap((type) => {
            const target = targets.find((item) => item.type === type);
            return target && target.enabled(host) ? [target] : [];
          });
          if (availableTypes.length === 0) return null;
          return (
            <div
              key={host.id}
              className={`flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0 ${config.layout === "grid" ? "flex-col items-start" : ""}`}
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {config.showStatus && (
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${statusDotClass(host)}`}
                  />
                )}
                <span className="text-xs font-medium text-foreground truncate">
                  {host.name || host.ip}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0 flex-wrap">
                {availableTypes.map((target) => (
                  <button
                    key={target.type}
                    title={t(target.labelKey, target.type)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      openTab(host, target.type);
                    }}
                    className="p-1.5 text-muted-foreground hover:text-accent-brand hover:bg-accent-brand/10 transition-colors border border-transparent hover:border-accent-brand/20"
                  >
                    <target.icon size={12} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

registerWidget<QuickConnectConfig>({
  id: "quick_connect",
  name: "Quick Connect",
  description:
    "Launch terminal, files, docker, tunnels, and more for your hosts",
  category: "system",
  icon: <Zap size={14} />,
  defaultConfig: {
    hostIds: [],
    connectionTypes: [],
    showStatus: true,
    layout: "list",
  },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 8 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: QuickConnectWidget,
});
