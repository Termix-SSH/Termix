/* eslint-disable react-refresh/only-export-components */
import {
  Box,
  FolderSearch,
  LayoutDashboard,
  Monitor,
  Network,
  Server,
  Settings,
  Terminal,
  User,
  Activity,
  TerminalSquare,
  Layers, // --- tmux-monitor ---
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext";
import { Terminal as TerminalFeature } from "@/features/terminal/Terminal";
import type {
  TerminalHandle,
  TerminalHostConfig,
} from "@/features/terminal/Terminal";
import { FileManager } from "@/features/file-manager/FileManager";
import { DockerManager } from "@/features/docker/DockerManager";
import { HostMetricsTab } from "@/features/host-metrics/HostMetricsTab";
// --- tmux-monitor ---
import { TmuxMonitor } from "@/features/tmux-monitor/TmuxMonitor";
import GuacamoleApp from "@/features/guacamole/GuacamoleApp";
import { DashboardTab } from "@/dashboard/DashboardTab";
import { TunnelTab } from "@/features/tunnel/TunnelTab";
import { NetworkGraphCard } from "@/dashboard/cards/NetworkGraphCard";
import type { Tab, TabType, Host } from "@/types/ui-types";
import type { SSHHost } from "@/types";
import { useTabsSafe } from "@/shell/TabContext";

function hostToSSHHost(h: Host): SSHHost {
  return {
    id: parseInt(h.id, 10),
    name: h.name,
    ip: h.ip,
    port: h.port,
    username: h.username,
    folder: h.folder ?? "",
    tags: h.tags ?? [],
    pin: h.pin ?? false,
    authType: h.authType,
    password: h.password,
    key: h.key,
    keyPassword: h.keyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId ? parseInt(h.credentialId, 10) : undefined,
    terminalConfig: h.terminalConfig,
    enableTerminal: h.enableTerminal ?? false,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
    showTerminalInSidebar: true,
    showFileManagerInSidebar: true,
    showTunnelInSidebar: true,
    showDockerInSidebar: true,
    showServerStatsInSidebar: true,
    defaultPath: h.defaultPath ?? "",
    tunnelConnections: [],
    connectionType: "ssh",
    createdAt: "",
    updatedAt: "",
  } as SSHHost;
}

function EmptyState({
  icon: Icon,
  messageKey,
}: {
  icon: React.ElementType;
  messageKey: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
      <div className="size-10 rounded-full bg-muted/40 flex items-center justify-center">
        <Icon className="size-5 text-muted-foreground/30" />
      </div>
      <span className="text-sm font-semibold text-muted-foreground/60">
        {t(messageKey)}
      </span>
    </div>
  );
}

export function tabIcon(type: TabType) {
  switch (type) {
    case "dashboard":
      return <LayoutDashboard className="size-3.5" />;
    case "terminal":
      return <Terminal className="size-3.5" />;
    case "rdp":
      return <Monitor className="size-3.5" />;
    case "vnc":
      return <Monitor className="size-3.5" />;
    case "telnet":
      return <Terminal className="size-3.5" />;
    case "host-metrics":
      return <Server className="size-3.5" />;
    case "files":
      return <FolderSearch className="size-3.5" />;
    case "host-manager":
      return <Server className="size-3.5" />;
    case "user-profile":
      return <User className="size-3.5" />;
    case "admin-settings":
      return <Settings className="size-3.5" />;
    case "docker":
      return <Box className="size-3.5" />;
    case "tunnel":
      return <Network className="size-3.5" />;
    case "network_graph":
      return <Network className="size-3.5" />;
    // --- tmux-monitor ---
    case "tmux_monitor":
      return <Layers className="size-3.5" />;
  }
}

function TerminalTabContent({
  tab,
  host,
  label,
  isVisible,
  onCloseTab,
}: {
  tab: Tab;
  host: Host;
  label: string;
  isVisible: boolean;
  onCloseTab?: (id: string) => void;
}) {
  const { previewTerminalTheme } = useTabsSafe();
  return (
    <CommandHistoryProvider>
      <TerminalFeature
        ref={tab.terminalRef as React.Ref<TerminalHandle>}
        hostConfig={
          {
            ...hostToSSHHost(host),
            sshPort: host.sshPort ?? host.port,
            instanceId: tab.instanceId ?? tab.id,
            restoredSessionId: tab.restoredSessionId ?? null,
          } as TerminalHostConfig
        }
        isVisible={isVisible}
        title={label}
        showTitle={false}
        splitScreen={false}
        onClose={() => onCloseTab?.(tab.id)}
        previewTheme={previewTerminalTheme}
      />
    </CommandHistoryProvider>
  );
}

export function renderTabContent(
  tab: Tab,
  onOpenSingletonTab?: (type: TabType) => void,
  onOpenTab?: (host: Host, type: TabType) => void,
  onCloseTab?: (id: string) => void,
  isVisible = true,
) {
  const { host, label } = tab;

  switch (tab.type) {
    case "dashboard":
      return (
        <DashboardTab
          onOpenSingletonTab={onOpenSingletonTab!}
          onOpenTab={onOpenTab!}
        />
      );

    case "terminal":
      if (!host)
        return (
          <EmptyState
            icon={TerminalSquare}
            messageKey="terminal.noHostSelected"
          />
        );
      return (
        <TerminalTabContent
          tab={tab}
          host={host}
          label={label}
          isVisible={isVisible}
          onCloseTab={onCloseTab}
        />
      );

    case "files":
      if (!host)
        return (
          <EmptyState
            icon={FolderSearch}
            messageKey="fileManager.noHostSelected"
          />
        );
      return <FileManager initialHost={hostToSSHHost(host)} />;

    case "docker":
      if (!host)
        return <EmptyState icon={Box} messageKey="docker.noHostSelected" />;
      return (
        <DockerManager
          hostConfig={hostToSSHHost(host)}
          title={label}
          isVisible={isVisible}
          isTopbarOpen={false}
          embedded={true}
        />
      );

    case "host-metrics":
      if (!host)
        return (
          <EmptyState icon={Activity} messageKey="hostMetrics.noHostSelected" />
        );
      return (
        <HostMetricsTab
          hostConfig={hostToSSHHost(host)}
          title={label}
          isVisible={isVisible}
          isTopbarOpen={false}
          embedded={true}
        />
      );

    case "tunnel":
      return <TunnelTab label={label} host={host} />;

    case "rdp":
    case "vnc":
    case "telnet":
      if (!host)
        return (
          <EmptyState icon={Monitor} messageKey="guacamole.noHostSelected" />
        );
      return (
        <GuacamoleApp
          hostId={host.id}
          tabId={tab.id}
          protocol={tab.type as "rdp" | "vnc" | "telnet"}
        />
      );

    case "network_graph":
      return <NetworkGraphCard embedded={false} />;

    // --- tmux-monitor ---
    case "tmux_monitor":
      return (
        <TmuxMonitor
          initialHostId={host ? parseInt(host.id, 10) : undefined}
          isVisible={isVisible}
        />
      );

    case "host-manager":
    case "user-profile":
    case "admin-settings":
      return null;
  }
}
