/* eslint-disable react-refresh/only-export-components */
import {
  Braces,
  FolderSearch,
  LayoutDashboard,
  LayoutGrid,
  LayoutPanelLeft,
  Network,
  ArrowLeftRight,
  Server,
  Settings,
  Usb,
  User,
  TerminalSquare,
  Layers, // --- tmux-monitor ---
  Clock,
  Fingerprint,
  Hammer,
  Play,
  ScrollText,
  Presentation,
} from "lucide-react";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { SerialHandle } from "@/features/serial/serial-types";
import type { Tab, TabType } from "@/types/ui-types";
import { hostToSSHHost } from "@/lib/host-to-ssh-host";
import { PluginViewPlaceholder } from "@/plugin-host/PluginViewPlaceholder";
import {
  getTabType,
  type TabShellCallbacks,
  type TabTypeDef,
} from "./tab-registry";
import {
  markAdaptiveResourceUsed,
  runAdaptiveBackgroundTask,
} from "@/lib/adaptive-resource-budget";

// Heavy tab surfaces — keep out of the AppShell critical path.
const CollabRoomTab = lazy(() =>
  import("@/features/collab/CollabRoomTab").then((m) => ({
    default: m.CollabRoomTab,
  })),
);
const LocalTerminal = lazy(() =>
  import("@/features/local-terminal/LocalTerminal").then((m) => ({
    default: m.LocalTerminal,
  })),
);
const loadFileManager = () =>
  import("@/features/file-manager/FileManager").then((m) => ({
    default: m.FileManager,
  }));
const FileManager = lazy(loadFileManager);
const loadTmuxMonitor = () =>
  import("@/features/tmux-monitor/TmuxMonitor").then((m) => ({
    default: m.TmuxMonitor,
  }));
const TmuxMonitor = lazy(loadTmuxMonitor);
const DashboardTab = lazy(() =>
  import("@/dashboard/DashboardTab").then((m) => ({
    default: m.DashboardTab,
  })),
);
const HomepageCanvas = lazy(() =>
  import("@/features/homepage/HomepageCanvas").then((m) => ({
    default: m.HomepageCanvas,
  })),
);
const loadTunnelTab = () =>
  import("@/features/tunnel/TunnelTab").then((m) => ({
    default: m.TunnelTab,
  }));
const TunnelTab = lazy(loadTunnelTab);
const SftpTransferTab = lazy(() =>
  import("@/features/sftp/SftpTransferTab").then((m) => ({
    default: m.SftpTransferTab,
  })),
);
const Serial = lazy(() =>
  import("@/features/serial/Serial").then((m) => ({
    default: m.Serial,
  })),
);
// Rail panels promoted to full tabs.
const TermixIdPanel = lazy(() =>
  import("@/sidebar/TermixIdPanel").then((m) => ({ default: m.TermixIdPanel })),
);
const SessionLogsPanel = lazy(() =>
  import("@/sidebar/SessionLogsPanel").then((m) => ({
    default: m.SessionLogsPanel,
  })),
);
const SnippetsPanel = lazy(() =>
  import("@/sidebar/SnippetsPanel").then((m) => ({ default: m.SnippetsPanel })),
);
const MacrosPanel = lazy(() =>
  import("@/sidebar/MacrosPanel").then((m) => ({ default: m.MacrosPanel })),
);
const HistoryPanel = lazy(() =>
  import("@/sidebar/HistoryPanel").then((m) => ({ default: m.HistoryPanel })),
);
const SshToolsPanel = lazy(() =>
  import("@/sidebar/SshToolsPanel").then((m) => ({ default: m.SshToolsPanel })),
);
const tabSurfaceLoaders: Partial<Record<TabType, () => Promise<unknown>>> = {
  files: loadFileManager,
  tmux_monitor: loadTmuxMonitor,
  tunnel: loadTunnelTab,
};

/** Download a likely next tab without starting a connection or mounting UI. */
export function preloadTabSurface(type: TabType): void {
  const loader = tabSurfaceLoaders[type] ?? getTabType(type)?.preload;
  if (loader) runAdaptiveBackgroundTask("module", `tab:${type}`, loader);
}

export function markTabSurfaceUsed(type: TabType): void {
  markAdaptiveResourceUsed("module", `tab:${type}`);
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

function TabChunkFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="size-5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/70 animate-spin" />
    </div>
  );
}

function withTabSuspense(node: React.ReactNode) {
  return <Suspense fallback={<TabChunkFallback />}>{node}</Suspense>;
}

/**
 * Host frame for rail panels opened as tabs. Panels expect a full-height flex
 * column like the sidebar gives them. The max width keeps forms readable on a
 * wide monitor instead of stretching them edge to edge.
 */
function PanelTabFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full justify-center overflow-y-auto bg-background">
      <div className="flex flex-col flex-1 min-h-0 w-full max-w-5xl">
        {children}
      </div>
    </div>
  );
}

export function tabIcon(type: TabType) {
  switch (type) {
    case "dashboard":
      return <LayoutDashboard className="size-3.5" />;
    case "local-terminal":
      return <TerminalSquare className="size-3.5" />;
    case "files":
      return <FolderSearch className="size-3.5" />;
    case "host-manager":
      return <Server className="size-3.5" />;
    case "user-profile":
      return <User className="size-3.5" />;
    case "admin-settings":
      return <Settings className="size-3.5" />;
    case "tunnel":
      return <Network className="size-3.5" />;
    case "sftp":
      return <ArrowLeftRight className="size-3.5" />;
    // --- tmux-monitor ---
    case "tmux_monitor":
      return <Layers className="size-3.5" />;
    case "serial":
      return <Usb className="size-3.5" />;
    case "homepage":
      return <LayoutGrid className="size-3.5" />;
    case "collab":
      return <Presentation className="size-3.5" />;
    case "termix-id":
      return <Fingerprint className="size-3.5" />;
    case "session-logs":
      return <ScrollText className="size-3.5" />;
    case "snippets":
      return <Play className="size-3.5" />;
    case "macros":
      return <Braces className="size-3.5" />;
    case "history":
      return <Clock className="size-3.5" />;
    case "ssh-tools":
      return <Hammer className="size-3.5" />;
    case "split-screen":
      return <LayoutPanelLeft className="size-3.5" />;
    default: {
      const Icon = getTabType(type)?.icon;
      return Icon ? <Icon className="size-3.5" /> : null;
    }
  }
}

/**
 * A plugin's tab: its registered component with the generic render props.
 * Unregistered types get the ownership placeholder in renderTabContent.
 */
function RegisteredTab({
  def,
  tab,
  isVisible,
  isFocusedPane,
  shell,
}: {
  def: TabTypeDef;
  tab: Tab;
  isVisible: boolean;
  isFocusedPane: boolean;
  shell: TabShellCallbacks;
}) {
  const { host, label } = tab;
  if (def.requiresHost && !host) {
    return (
      <EmptyState
        icon={Server}
        messageKey={def.noHostMessageKey ?? "hosts.noHostSelected"}
      />
    );
  }
  const Component = def.component;
  const content = (
    <Component
      tab={tab}
      host={host}
      sshHost={
        host
          ? (hostToSSHHost(host) as unknown as Record<string, unknown>)
          : undefined
      }
      label={label}
      isVisible={isVisible}
      isFocusedPane={isFocusedPane}
      handleRef={tab.terminalRef as React.Ref<unknown>}
      shell={shell}
    />
  );
  return withTabSuspense(
    def.panelFrame ? <PanelTabFrame>{content}</PanelTabFrame> : content,
  );
}

/**
 * Everything the promoted rail panels need from AppShell. Passed as one bag
 * rather than more positional params, which renderTabContent already has too
 * many of.
 */
export type PromotedPanelProps = {
  terminalTabs?: Tab[];
  targetTerminalTabId?: string;
  storageMode?: "local" | "cloud";
};

export interface TabRenderContext {
  shell: TabShellCallbacks;
  isVisible?: boolean;
  isFocusedPane?: boolean;
  panelProps?: PromotedPanelProps;
}

export function renderTabContent(tab: Tab, context: TabRenderContext) {
  const { shell, isVisible = true, isFocusedPane = true, panelProps } = context;
  const { host, label } = tab;

  switch (tab.type) {
    case "dashboard":
      return withTabSuspense(
        <DashboardTab
          onOpenSingletonTab={(type) => shell.openSingletonTab(type)}
          onOpenTab={(host, type) => shell.openTab(host, type)}
          isVisible={isVisible}
        />,
      );

    case "local-terminal":
      return withTabSuspense(
        <LocalTerminal instanceId={tab.instanceId} isVisible={isVisible} />,
      );

    case "files":
      if (!host)
        return (
          <EmptyState
            icon={FolderSearch}
            messageKey="fileManager.noHostSelected"
          />
        );
      return withTabSuspense(
        <FileManager
          initialHost={hostToSSHHost(host)}
          initialFilePath={tab.initialFilePath}
          initialPath={tab.initialPath}
          isVisible={isVisible}
          onOpenTerminalTab={(path) => shell.openTerminalTab(host, path)}
        />,
      );

    case "tunnel":
      return withTabSuspense(
        <TunnelTab label={label} host={host} isVisible={isVisible} />,
      );

    case "sftp":
      return withTabSuspense(<SftpTransferTab />);

    // --- tmux-monitor ---
    case "tmux_monitor":
      return withTabSuspense(
        <TmuxMonitor
          initialHostId={host ? parseInt(host.id, 10) : undefined}
          isVisible={isVisible}
        />,
      );

    case "serial":
      if (!tab.serialConfig)
        return <EmptyState icon={Usb} messageKey="serial.notSupportedTitle" />;
      return withTabSuspense(
        <Serial
          ref={tab.terminalRef as React.Ref<SerialHandle>}
          config={tab.serialConfig}
          isVisible={isVisible}
          instanceId={tab.instanceId}
        />,
      );

    case "homepage":
      return withTabSuspense(<HomepageCanvas />);

    case "collab":
      return withTabSuspense(
        <CollabRoomTab roomId={tab.collabRoomId} isVisible={isVisible} />,
      );

    case "termix-id":
      return withTabSuspense(
        <PanelTabFrame>
          <TermixIdPanel />
        </PanelTabFrame>,
      );

    case "session-logs":
      return withTabSuspense(
        <PanelTabFrame>
          <SessionLogsPanel />
        </PanelTabFrame>,
      );

    case "split-screen":
      return null;

    case "snippets":
      return withTabSuspense(
        <PanelTabFrame>
          <SnippetsPanel
            terminalTabs={panelProps?.terminalTabs ?? []}
            activeTabId={panelProps?.targetTerminalTabId ?? ""}
            storageMode={panelProps?.storageMode ?? "local"}
          />
        </PanelTabFrame>,
      );

    case "macros":
      return withTabSuspense(
        <PanelTabFrame>
          <MacrosPanel
            terminalTabs={panelProps?.terminalTabs ?? []}
            activeTabId={panelProps?.targetTerminalTabId ?? ""}
            storageMode={panelProps?.storageMode ?? "local"}
          />
        </PanelTabFrame>,
      );

    case "history":
      return withTabSuspense(
        <PanelTabFrame>
          <HistoryPanel
            terminalTabs={panelProps?.terminalTabs ?? []}
            activeTabId={panelProps?.targetTerminalTabId ?? ""}
          />
        </PanelTabFrame>,
      );

    case "ssh-tools":
      return withTabSuspense(
        <PanelTabFrame>
          <SshToolsPanel
            terminalTabs={panelProps?.terminalTabs ?? []}
            activeTabId={panelProps?.targetTerminalTabId ?? ""}
          />
        </PanelTabFrame>,
      );

    case "host-manager":
    case "user-profile":
    case "admin-settings":
      return null;

    default: {
      const def = getTabType(tab.type);
      if (!def) {
        return <PluginViewPlaceholder kind="tab" viewId={tab.type} />;
      }
      return (
        <RegisteredTab
          def={def}
          tab={tab}
          isVisible={isVisible}
          isFocusedPane={isFocusedPane}
          shell={shell}
        />
      );
    }
  }
}
