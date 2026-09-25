import { useEffect, useState } from "react";
import {
  AlertCircle,
  Clock,
  ExternalLink,
  Network,
  Play,
  RefreshCw,
  Settings,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  logActivity,
  useHost,
  useToast,
  useTranslation,
  type PluginHostRecord,
} from "@termix/plugin-sdk/frontend";
import { Button, Card } from "@termix/plugin-sdk/ui";
import type { TunnelConnection, TunnelStatus } from "../shared/types";
import { serverTunnelName, tunnelHostLabel } from "../shared/tunnel-naming";
import {
  cancelTunnel,
  connectTunnel,
  disconnectTunnel,
  subscribeTunnelStatuses,
  type TunnelStatusMap,
} from "./api";
import {
  connectRequestFor,
  hostTunnelSettings,
  tunnelMode,
} from "./host-tunnels";

type StatusLabel =
  "CONNECTED" | "CONNECTING" | "ERROR" | "WAITING" | "DISCONNECTED";

function statusLabel(status: TunnelStatus | undefined): StatusLabel {
  const value = status?.status?.toUpperCase();
  if (value === "CONNECTED") return "CONNECTED";
  if (value === "CONNECTING" || value === "VERIFYING") return "CONNECTING";
  if (value === "FAILED") return "ERROR";
  if (value === "RETRYING" || value === "WAITING") return "WAITING";
  return "DISCONNECTED";
}

const STATUS_TEXT_KEYS: Record<StatusLabel, string> = {
  CONNECTED: "tunnels.connected",
  CONNECTING: "tunnels.connecting",
  ERROR: "tunnels.error",
  WAITING: "tunnels.waiting",
  DISCONNECTED: "tunnels.disconnected",
};

function TunnelCard({
  host,
  tunnel,
  status,
  isActing,
  onAction,
}: {
  host: PluginHostRecord;
  tunnel: TunnelConnection;
  status: TunnelStatus | undefined;
  isActing: boolean;
  onAction: (action: "connect" | "disconnect" | "cancel") => void;
}) {
  const { t } = useTranslation();
  const [showSettings, setShowSettings] = useState(false);
  const label = statusLabel(status);
  const isConnected = label === "CONNECTED";
  const isConnecting = label === "CONNECTING";
  const isError = label === "ERROR";
  const isWaiting = label === "WAITING";

  let statusColor = "text-muted-foreground border-border bg-muted/30";
  if (isConnected)
    statusColor = "text-accent-brand border-accent-brand/40 bg-accent-brand/10";
  if (isConnecting)
    statusColor = "text-blue-400 border-blue-400/40 bg-blue-400/10";
  if (isError)
    statusColor = "text-destructive border-destructive/40 bg-destructive/10";
  if (isWaiting)
    statusColor = "text-yellow-500 border-yellow-500/40 bg-yellow-500/10";

  const mode = tunnelMode(tunnel);
  const destination =
    mode === "dynamic"
      ? t("tunnels.socksProxy")
      : `${tunnel.endpointHost ?? ""}:${tunnel.endpointPort}`;

  return (
    <Card className="flex flex-col overflow-hidden p-0 gap-0">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/10">
        <div className="flex items-center gap-2">
          <Network className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {t("tunnels.port")} {tunnel.sourcePort}
          </span>
        </div>
        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 border text-[10px] font-bold uppercase ${statusColor}`}
        >
          {isConnecting || isActing ? (
            <RefreshCw className="size-3 animate-spin" />
          ) : isConnected ? (
            <Wifi className="size-3" />
          ) : isError ? (
            <AlertCircle className="size-3" />
          ) : isWaiting ? (
            <Clock className="size-3" />
          ) : (
            <WifiOff className="size-3" />
          )}
          {isActing ? t("tunnels.working") : t(STATUS_TEXT_KEYS[label])}
        </div>
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
            {t("tunnels.destination")}
          </span>
          <span
            className="text-sm font-mono font-semibold truncate"
            title={destination}
          >
            {destination}
          </span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] font-semibold px-1.5 py-px border border-border text-muted-foreground uppercase">
              {mode}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {t("tunnels.listensOn", { port: tunnel.sourcePort })}
            </span>
          </div>
        </div>

        {isError && status?.reason && (
          <div className="flex items-start gap-2 p-2 bg-destructive/5 border border-destructive/20 text-destructive text-[10px]">
            <AlertCircle className="size-3 mt-0.5 shrink-0" />
            <span>{status.reason}</span>
          </div>
        )}

        {showSettings && (
          <div className="border border-border bg-muted/20 p-3 flex flex-col gap-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground font-semibold">
                {t("tunnels.host")}
              </span>
              <span className="font-mono">{tunnelHostLabel(host)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground font-semibold">
                {t("tunnels.mode")}
              </span>
              <span className="uppercase font-bold">{mode}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground font-semibold">
                {t("tunnels.localPort")}
              </span>
              <span className="font-mono">{tunnel.sourcePort}</span>
            </div>
            {mode !== "dynamic" && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-semibold">
                    {t("tunnels.remoteHost")}
                  </span>
                  <span className="font-mono">{tunnel.endpointHost}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-semibold">
                    {t("tunnels.remotePort")}
                  </span>
                  <span className="font-mono">{tunnel.endpointPort}</span>
                </div>
              </>
            )}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground font-semibold">
                {t("tunnels.maxRetries")}
              </span>
              <span className="font-mono">{tunnel.maxRetries}</span>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-1">
          {isConnected ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive gap-1.5"
              disabled={isActing}
              onClick={() => onAction("disconnect")}
            >
              <Square className="size-3" />
              {t("tunnels.stop")}
            </Button>
          ) : isConnecting || isWaiting ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-yellow-500 border-yellow-500/40 hover:bg-yellow-500/10 hover:text-yellow-500 gap-1.5"
              disabled={isActing}
              onClick={() => onAction("cancel")}
            >
              <Square className="size-3" />
              {t("tunnels.cancel")}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-accent-brand border-accent-brand/40 hover:bg-accent-brand/10 hover:text-accent-brand gap-1.5"
              disabled={isActing}
              onClick={() => onAction("connect")}
            >
              {isActing ? (
                <RefreshCw className="size-3 animate-spin" />
              ) : (
                <Play className="size-3" />
              )}
              {t("tunnels.start")}
            </Button>
          )}
          <Button
            variant={showSettings ? "secondary" : "ghost"}
            size="icon"
            className={`h-8 w-8 ${showSettings ? "bg-accent-brand/10 text-accent-brand" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setShowSettings((s) => !s)}
          >
            <Settings className="size-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** A host's saved server tunnels, with live status and start/stop controls. */
export function TunnelTab({ host: given }: { host?: PluginHostRecord }) {
  const { t } = useTranslation();
  const toast = useToast();
  const live = useHost(given?.id);
  const host = live ?? given ?? null;
  const [statuses, setStatuses] = useState<TunnelStatusMap>({});
  const [acting, setActing] = useState<Record<string, boolean>>({});

  useEffect(() => subscribeTunnelStatuses(setStatuses), []);

  // One recent-activity entry per host opened here.
  const hostId = host?.id;
  const hostLabel = host ? tunnelHostLabel(host) : "";
  useEffect(() => {
    if (typeof hostId !== "number") return;
    logActivity("tunnel", hostId, hostLabel).catch(() => {});
  }, [hostId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!host) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
        <div className="size-10 bg-muted/40 flex items-center justify-center">
          <Network className="size-5 text-muted-foreground/30" />
        </div>
        <span className="text-sm font-semibold text-muted-foreground/60">
          {t("tunnels.noHostSelected")}
        </span>
      </div>
    );
  }

  const tunnels = hostTunnelSettings(host).connections;
  const names = tunnels.map((tunnel, index) =>
    serverTunnelName(host, index, tunnel),
  );
  const connectedCount = names.filter(
    (name) => statuses[name]?.status === "connected",
  ).length;

  const handleAction = async (
    action: "connect" | "disconnect" | "cancel",
    index: number,
  ) => {
    const tunnel = tunnels[index];
    if (!tunnel) return;
    const name = names[index];
    setActing((current) => ({ ...current, [name]: true }));
    try {
      if (action === "connect") {
        await connectTunnel(connectRequestFor(host, index, tunnel));
        toast.success(t("tunnels.clientTunnelStarted"));
      } else if (action === "disconnect") {
        await disconnectTunnel(name);
        toast.info(t("tunnels.clientTunnelStopped"));
      } else {
        await cancelTunnel(name);
        toast.info(t("tunnels.canceling"));
      }
    } catch {
      toast.error(t("tunnels.manualControlError"));
    } finally {
      setActing((current) => ({ ...current, [name]: false }));
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        <Card className="flex-row items-center justify-between px-3 py-3 shrink-0 gap-0">
          <div className="flex items-center gap-3">
            <div className="size-10 border border-border bg-muted flex items-center justify-center shrink-0">
              <Network className="size-5 text-accent-brand" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{host.name}</h1>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-accent-brand" />
                <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                  {t("tunnels.activeCount", {
                    connected: connectedCount,
                    total: tunnels.length,
                  })}
                </span>
              </div>
            </div>
          </div>
          <a
            href="https://docs.termix.site/features/networking/tunnels"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center size-9 text-muted-foreground hover:text-foreground transition-colors"
            title={t("hosts.docsLink")}
          >
            <ExternalLink className="size-4" />
          </a>
        </Card>

        {tunnels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {tunnels.map((tunnel, index) => (
              <TunnelCard
                key={names[index]}
                host={host}
                tunnel={tunnel}
                status={statuses[names[index]]}
                isActing={acting[names[index]] ?? false}
                onAction={(action) => handleAction(action, index)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
            <div className="opacity-10 flex flex-col items-center gap-4">
              <Network className="size-16" />
              <span className="text-xl font-bold uppercase tracking-widest">
                {t("tunnels.noSshTunnels")}
              </span>
            </div>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {t("tunnels.createFirstTunnelMessage")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
