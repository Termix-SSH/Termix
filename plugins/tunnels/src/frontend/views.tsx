import { Network } from "lucide-react";
import {
  useHosts,
  useTranslation,
  type PluginHostRecord,
  type StandaloneViewProps,
} from "@termix/plugin-sdk/frontend";
import {
  ConnectionScreen,
  FullScreenAppWrapper,
  Select2,
} from "@termix/plugin-sdk/ui";
import { TunnelTab } from "./TunnelTab";
import { C2STunnelPresetManager } from "./C2STunnelPresetManager";
import { hostTunnelSettings } from "./host-tunnels";

/** The `?view=tunnel` full-screen page for one host. */
export function TunnelStandalone({ hostId }: StandaloneViewProps) {
  const { t } = useTranslation();
  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, phase) => {
        if (phase === "loading") {
          return (
            <div className="relative h-full w-full">
              <ConnectionScreen
                status="connecting"
                message={t("hosts.loadingHost")}
              />
            </div>
          );
        }
        if (!hostConfig) {
          return (
            <div className="relative h-full w-full">
              <ConnectionScreen
                status="disconnected"
                message={t("hosts.hostNotFound")}
              />
            </div>
          );
        }
        const host = {
          ...hostConfig,
          id: String(hostConfig.id),
        } as unknown as PluginHostRecord;
        return <TunnelTab host={host} />;
      }}
    </FullScreenAppWrapper>
  );
}

/** The rail panel for the desktop app's client tunnels. */
export function PortForwardingPanel() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-2">
      <C2STunnelPresetManager />
    </div>
  );
}

export interface TunnelWidgetConfig {
  hostId: number;
}

/** Homepage widget: the tunnel tab for one host. */
export function TunnelWidget({
  widget,
  config,
}: {
  widget: { title?: string | null };
  config: TunnelWidgetConfig;
}) {
  const { t } = useTranslation();
  const { hosts, loaded } = useHosts();

  const placeholder = (text: string) => (
    <div className="flex flex-col items-center justify-center w-full h-full gap-2 text-xs text-muted-foreground/60">
      <Network size={20} />
      <span>{text}</span>
    </div>
  );

  if (!config.hostId) return placeholder(t("homepage.widgetNoHostSelected"));
  if (!loaded) return placeholder(t("homepage.loading"));

  const host = hosts.find(
    (candidate) =>
      String(candidate.id) === String(config.hostId) &&
      hostTunnelSettings(candidate).enabled,
  );
  if (!host) return placeholder(t("homepage.widgetNoHostSelected"));

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      {widget.title && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/50 shrink-0">
          <span className="text-accent-brand shrink-0">
            <Network size={11} />
          </span>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
            {widget.title}
          </span>
        </div>
      )}
      <div
        className="flex-1 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <TunnelTab host={host} />
      </div>
    </div>
  );
}

/** The widget's edit form: pick a host with tunnels on. */
export function TunnelWidgetEditForm({
  config,
  onChange,
}: {
  config: TunnelWidgetConfig;
  onChange: (config: TunnelWidgetConfig) => void;
}) {
  const { t } = useTranslation();
  const { hosts } = useHosts();
  const options = hosts.filter(
    (host) => host.enableSsh !== false && hostTunnelSettings(host).enabled,
  );

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">
        {t("homepage.host")}
      </label>
      <Select2
        value={config.hostId || ""}
        onChange={(e) =>
          onChange({ ...config, hostId: Number(e.target.value) })
        }
        className="h-8 text-xs border border-border bg-background px-2"
      >
        <option value="">{t("homepage.selectHost")}</option>
        {options.map((host) => (
          <option key={host.id} value={host.id}>
            {host.name || host.ip}
          </option>
        ))}
      </Select2>
    </div>
  );
}
