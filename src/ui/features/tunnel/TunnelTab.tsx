import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Card } from "@/components/card";

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
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  getSSHHosts,
  subscribeTunnelStatuses,
  connectTunnel,
  disconnectTunnel,
  cancelTunnel,
  logActivity,
} from "@/main-axios";
import type { Host as DemoHost } from "@/types/ui-types";
import type { SSHHost, TunnelConnection, TunnelStatus } from "@/types";

function tunnelName(
  host: SSHHost,
  index: number,
  tunnel: TunnelConnection,
): string {
  const hostKey = host.name || `${host.username}@${host.ip}`;
  return `${host.id}::${index}::${hostKey}::${tunnel.sourcePort}::${tunnel.endpointHost}::${tunnel.endpointPort}`;
}

function statusLabel(status: TunnelStatus | undefined): string {
  if (!status) return "DISCONNECTED";
  const s = status.status?.toUpperCase();
  if (s === "CONNECTED") return "CONNECTED";
  if (s === "CONNECTING" || s === "VERIFYING") return "CONNECTING";
  if (s === "FAILED") return "ERROR";
  if (s === "RETRYING" || s === "WAITING") return "WAITING";
  if (s === "DISCONNECTING") return "DISCONNECTED";
  return "DISCONNECTED";
}

function TunnelCard({
  host,
  tunnel,
  status,
  isActing,
  onAction,
}: {
  host: SSHHost;
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

  const mode = tunnel.mode ?? (tunnel.tunnelType as string) ?? "local";
  const destination =
    mode === "dynamic"
      ? "SOCKS5 Proxy"
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
          className={`flex items-center gap-1.5 px-2 py-0.5 border text-[10px] font-bold ${statusColor}`}
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
          {isActing ? t("tunnels.working") : label}
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
              → localhost:{tunnel.sourcePort}
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
              <span className="font-mono">
                {host.name || `${host.username}@${host.ip}`}
              </span>
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

export function TunnelTab({ host }: { label: string; host?: DemoHost }) {
  const { t } = useTranslation();
  const [sshHost, setSshHost] = useState<SSHHost | null>(null);
  const [tunnelStatuses, setTunnelStatuses] = useState<
    Record<string, TunnelStatus>
  >({});
  const [tunnelActions, setTunnelActions] = useState<Record<string, boolean>>(
    {},
  );
  const activityLoggedRef = React.useRef(false);

  const fetchHost = useCallback(async () => {
    if (!host) return;
    try {
      const hosts = await getSSHHosts();
      const found = hosts.find(
        (h) => String(h.id) === host.id || h.name === host.name,
      );
      if (found) setSshHost(found);
    } catch {
      /* ignore */
    }
  }, [host]);

  useEffect(() => {
    fetchHost();
    const interval = setInterval(fetchHost, 5000);
    window.addEventListener("ssh-hosts:changed", fetchHost);
    return () => {
      clearInterval(interval);
      window.removeEventListener("ssh-hosts:changed", fetchHost);
    };
  }, [fetchHost]);

  useEffect(() => {
    return subscribeTunnelStatuses(setTunnelStatuses, () => {});
  }, []);

  useEffect(() => {
    if (!sshHost || activityLoggedRef.current) return;
    activityLoggedRef.current = true;
    const name = sshHost.name || `${sshHost.username}@${sshHost.ip}`;
    logActivity("tunnel", sshHost.id, name).catch(() => {
      activityLoggedRef.current = false;
    });
  }, [sshHost]);

  const handleAction = async (
    action: "connect" | "disconnect" | "cancel",
    index: number,
  ) => {
    if (!sshHost) return;
    const tunnel = sshHost.tunnelConnections[index];
    if (!tunnel) return;
    const name = tunnelName(sshHost, index, tunnel);

    setTunnelActions((prev) => ({ ...prev, [name]: true }));
    try {
      if (action === "connect") {
        const isDirect =
          !tunnel.endpointHost ||
          tunnel.endpointHost === "127.0.0.1" ||
          tunnel.endpointHost === "localhost";
        let endpointSsh: SSHHost | undefined;
        if (!isDirect) {
          const allHosts = await getSSHHosts();
          endpointSsh = allHosts.find(
            (h) =>
              h.name === tunnel.endpointHost ||
              `${h.username}@${h.ip}` === tunnel.endpointHost,
          );
        }
        await connectTunnel({
          name,
          scope: tunnel.scope ?? "s2s",
          mode:
            tunnel.mode ??
            (tunnel.tunnelType as "local" | "remote" | "dynamic") ??
            "local",
          tunnelType:
            tunnel.tunnelType ??
            (tunnel.mode === "local" || tunnel.mode === "remote"
              ? tunnel.mode
              : "local"),
          bindHost: tunnel.bindHost,
          targetHost: tunnel.targetHost,
          sourceHostId: sshHost.id,
          tunnelIndex: index,
          hostName: sshHost.name || `${sshHost.username}@${sshHost.ip}`,
          sourceIP: sshHost.ip,
          sourceSSHPort: sshHost.port,
          sourceUsername: sshHost.username,
          sourcePassword:
            sshHost.authType === "password" ? sshHost.password : undefined,
          sourceAuthMethod: sshHost.authType,
          sourceSSHKey: sshHost.authType === "key" ? sshHost.key : undefined,
          sourceKeyPassword:
            sshHost.authType === "key" ? sshHost.keyPassword : undefined,
          sourceKeyType:
            sshHost.authType === "key" ? sshHost.keyType : undefined,
          sourceCredentialId: sshHost.credentialId,
          endpointHost: tunnel.endpointHost ?? "",
          endpointIP: isDirect
            ? sshHost.ip
            : (endpointSsh?.ip ?? tunnel.endpointHost ?? ""),
          endpointSSHPort: isDirect ? sshHost.port : (endpointSsh?.port ?? 22),
          endpointUsername: isDirect
            ? sshHost.username
            : (endpointSsh?.username ?? ""),
          endpointPassword:
            endpointSsh?.authType === "password"
              ? endpointSsh.password
              : undefined,
          endpointAuthMethod: endpointSsh?.authType ?? "password",
          endpointSSHKey:
            endpointSsh?.authType === "key" ? endpointSsh.key : undefined,
          endpointKeyPassword:
            endpointSsh?.authType === "key"
              ? endpointSsh.keyPassword
              : undefined,
          endpointKeyType:
            endpointSsh?.authType === "key" ? endpointSsh.keyType : undefined,
          endpointCredentialId: endpointSsh?.credentialId,
          sourcePort: tunnel.sourcePort,
          endpointPort: tunnel.endpointPort,
          maxRetries: tunnel.maxRetries,
          retryInterval: tunnel.retryInterval * 1000,
          autoStart: tunnel.autoStart,
          isPinned: sshHost.pin,
          useSocks5: sshHost.useSocks5,
          socks5Host: sshHost.socks5Host,
          socks5Port: sshHost.socks5Port,
          socks5Username: sshHost.socks5Username,
          socks5Password: sshHost.socks5Password,
        });
        toast.success(t("tunnels.clientTunnelStarted"));
      } else if (action === "disconnect") {
        await disconnectTunnel(name);
        toast.info(t("tunnels.clientTunnelStopped"));
      } else {
        await cancelTunnel(name);
        toast.info(t("tunnels.canceling"));
      }
    } catch (err) {
      toast.error(t("tunnels.manualControlError"));
      console.error("Tunnel action failed:", err);
    } finally {
      setTunnelActions((prev) => ({ ...prev, [name]: false }));
    }
  };

  if (!host) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
        <div className="size-10 rounded-full bg-muted/40 flex items-center justify-center">
          <Network className="size-5 text-muted-foreground/30" />
        </div>
        <span className="text-sm font-semibold text-muted-foreground/60">
          {t("tunnels.noHostSelected")}
        </span>
      </div>
    );
  }

  const tunnels = sshHost?.tunnelConnections ?? [];
  const connectedCount = tunnels.filter((t, i) => {
    if (!sshHost) return false;
    const name = tunnelName(sshHost, i, t);
    return tunnelStatuses[name]?.status === "connected";
  }).length;

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
                  {connectedCount}/{tunnels.length} {t("tunnels.active")}
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
            {tunnels.map((tunnel, index) => {
              if (!sshHost) return null;
              const name = tunnelName(sshHost, index, tunnel);
              return (
                <TunnelCard
                  key={name}
                  host={sshHost}
                  tunnel={tunnel}
                  status={tunnelStatuses[name]}
                  isActing={tunnelActions[name] ?? false}
                  onAction={(action) => handleAction(action, index)}
                />
              );
            })}
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
