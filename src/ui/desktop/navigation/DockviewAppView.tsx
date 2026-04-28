import React, {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewApi,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-core/dist/styles/dockview.css";
import type { GuacamoleConnectionConfig } from "@/ui/desktop/apps/features/guacamole/GuacamoleDisplay.tsx";
import type { SSHHost } from "@/types";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { useTheme } from "@/components/theme-provider";
import {
  TERMINAL_THEMES,
  DEFAULT_TERMINAL_CONFIG,
} from "@/constants/terminal-themes";

const Terminal = lazy(() =>
  import("@/ui/desktop/apps/features/terminal/Terminal.tsx").then((module) => ({
    default: module.Terminal,
  })),
);
const ServerView = lazy(() =>
  import("@/ui/desktop/apps/features/server-stats/ServerStats.tsx").then(
    (module) => ({ default: module.ServerStats }),
  ),
);
const FileManager = lazy(() =>
  import("@/ui/desktop/apps/features/file-manager/FileManager.tsx").then(
    (module) => ({ default: module.FileManager }),
  ),
);
const GuacamoleDisplay = lazy(() =>
  import("@/ui/desktop/apps/features/guacamole/GuacamoleDisplay.tsx").then(
    (module) => ({ default: module.GuacamoleDisplay }),
  ),
);
const TunnelManager = lazy(() =>
  import("@/ui/desktop/apps/features/tunnel/TunnelManager.tsx").then(
    (module) => ({ default: module.TunnelManager }),
  ),
);
const DockerManager = lazy(() =>
  import("@/ui/desktop/apps/features/docker/DockerManager.tsx").then(
    (module) => ({ default: module.DockerManager }),
  ),
);
const NetworkGraphCard = lazy(() =>
  import("@/ui/desktop/apps/dashboard/cards/NetworkGraphCard").then(
    (module) => ({ default: module.NetworkGraphCard }),
  ),
);

interface TabData {
  id: number;
  type: string;
  title: string;
  instanceId?: string;
  terminalRef?: {
    current?: {
      fit?: () => void;
      notifyResize?: () => void;
      refresh?: () => void;
      disconnect?: () => void;
    };
  };
  hostConfig?: SSHHost;
  connectionConfig?: GuacamoleConnectionConfig;
  [key: string]: unknown;
}

// Terminal-type tabs that dockview manages
const DOCKVIEW_TAB_TYPES = new Set([
  "terminal",
  "server_stats",
  "file_manager",
  "rdp",
  "vnc",
  "telnet",
  "tunnel",
  "docker",
  "network_graph",
]);

// ─── Panel content components ───────────────────────────────────────────────

function TerminalPanel({ params }: IDockviewPanelProps<TabData>) {
  const { tab, removeTab, updateTab, addTab, previewTerminalTheme } = params;
  const { theme: appTheme } = useTheme();

  const isDarkMode = useMemo(() => {
    if (appTheme === "dark" || appTheme === "dracula" || appTheme === "gentlemansChoice" || appTheme === "midnightEspresso" || appTheme === "catppuccinMocha") return true;
    if (appTheme === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, [appTheme]);

  const terminalConfig = {
    ...DEFAULT_TERMINAL_CONFIG,
    ...tab.hostConfig?.terminalConfig,
  };

  const activeTheme =
    tab.id === params.currentTab && previewTerminalTheme
      ? previewTerminalTheme
      : terminalConfig.theme;

  let themeColors;
  if (activeTheme === "termix") {
    themeColors = isDarkMode
      ? TERMINAL_THEMES.termixDark.colors
      : TERMINAL_THEMES.termixLight.colors;
  } else {
    themeColors =
      TERMINAL_THEMES[activeTheme]?.colors || TERMINAL_THEMES.termixDark.colors;
  }

  return (
    <div
      className="h-full w-full overflow-hidden"
      style={{ backgroundColor: themeColors.background }}
    >
      <Suspense fallback={null}>
        <Terminal
          key={`term-${tab.id}-${tab.instanceId || ""}`}
          ref={tab.terminalRef}
          hostConfig={tab.hostConfig}
          isVisible={true}
          title={tab.title}
          showTitle={false}
          splitScreen={false}
          onClose={() => removeTab(tab.id)}
          onTitleChange={(title: string) => updateTab(tab.id, { title })}
          onOpenFileManager={
            tab.hostConfig?.enableFileManager
              ? () =>
                  addTab({
                    type: "file_manager",
                    title: tab.title,
                    hostConfig: tab.hostConfig,
                  })
              : undefined
          }
          previewTheme={
            tab.id === params.currentTab ? previewTerminalTheme : null
          }
        />
      </Suspense>
    </div>
  );
}

function ServerStatsPanel({ params }: IDockviewPanelProps<TabData>) {
  const { tab, isTopbarOpen } = params;
  return (
    <div className="h-full w-full overflow-hidden">
      <Suspense fallback={null}>
        <ServerView
          key={`stats-${tab.id}-${tab.instanceId || ""}`}
          hostConfig={tab.hostConfig}
          title={tab.title}
          isVisible={true}
          isTopbarOpen={isTopbarOpen}
          embedded
        />
      </Suspense>
    </div>
  );
}

function FileManagerPanel({ params }: IDockviewPanelProps<TabData>) {
  const { tab, removeTab } = params;
  return (
    <div className="h-full w-full overflow-hidden">
      <Suspense fallback={null}>
        <FileManager
          key={`filemgr-${tab.id}-${tab.instanceId || ""}`}
          embedded
          initialHost={tab.hostConfig}
          onClose={() => removeTab(tab.id)}
        />
      </Suspense>
    </div>
  );
}

function GuacamolePanel({ params }: IDockviewPanelProps<TabData>) {
  const { tab, removeTab } = params;
  if (!tab.connectionConfig) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        Missing connection configuration
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-hidden">
      <Suspense fallback={null}>
        <GuacamoleDisplay
          key={`guac-${tab.id}-${tab.instanceId || ""}`}
          connectionConfig={tab.connectionConfig}
          isVisible={true}
          onDisconnect={() => removeTab(tab.id)}
          onError={(err) => removeTab(tab.id)}
        />
      </Suspense>
    </div>
  );
}

function TunnelPanel({ params }: IDockviewPanelProps<TabData>) {
  const { tab, isTopbarOpen } = params;
  return (
    <div className="h-full w-full overflow-hidden">
      <Suspense fallback={null}>
        <TunnelManager
          key={`tunnel-${tab.id}-${tab.instanceId || ""}`}
          hostConfig={tab.hostConfig}
          title={tab.title}
          isVisible={true}
          isTopbarOpen={isTopbarOpen}
          embedded
        />
      </Suspense>
    </div>
  );
}

function DockerPanel({ params }: IDockviewPanelProps<TabData>) {
  const { tab, removeTab, isTopbarOpen } = params;
  return (
    <div className="h-full w-full overflow-hidden">
      <Suspense fallback={null}>
        <DockerManager
          key={`docker-${tab.id}-${tab.instanceId || ""}`}
          hostConfig={tab.hostConfig}
          title={tab.title}
          isVisible={true}
          isTopbarOpen={isTopbarOpen}
          embedded
          onClose={() => removeTab(tab.id)}
        />
      </Suspense>
    </div>
  );
}

function NetworkGraphPanel({ params }: IDockviewPanelProps<TabData>) {
  const { isTopbarOpen, rightSidebarOpen, rightSidebarWidth } = params;
  return (
    <div className="h-full w-full overflow-hidden">
      <Suspense fallback={null}>
        <NetworkGraphCard
          key={`netgraph-${params.tab.id}-${params.tab.instanceId || ""}`}
          isTopbarOpen={isTopbarOpen}
          rightSidebarOpen={rightSidebarOpen}
          rightSidebarWidth={rightSidebarWidth}
          embedded={false}
        />
      </Suspense>
    </div>
  );
}

// ─── Panel registry ─────────────────────────────────────────────────────────

const PANEL_COMPONENTS: Record<string, React.FC<IDockviewPanelProps<TabData>>> =
  {
    terminal: TerminalPanel,
    server_stats: ServerStatsPanel,
    file_manager: FileManagerPanel,
    rdp: GuacamolePanel,
    vnc: GuacamolePanel,
    telnet: GuacamolePanel,
    tunnel: TunnelPanel,
    docker: DockerPanel,
    network_graph: NetworkGraphPanel,
  };

// ─── Main component ─────────────────────────────────────────────────────────

interface DockviewAppViewProps {
  isTopbarOpen?: boolean;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
}

export function DockviewAppView({
  isTopbarOpen = true,
  rightSidebarOpen = false,
  rightSidebarWidth = 400,
}: DockviewAppViewProps): React.ReactElement {
  const {
    tabs,
    currentTab,
    removeTab,
    updateTab,
    addTab,
    setCurrentTab,
    previewTerminalTheme,
  } = useTabs();
  const { state: sidebarState } = useSidebar();
  const { theme: appTheme } = useTheme();

  const apiRef = useRef<DockviewApi | null>(null);
  const syncingRef = useRef(false);

  const isDarkMode = useMemo(() => {
    if (appTheme === "dark" || appTheme === "dracula" || appTheme === "gentlemansChoice" || appTheme === "midnightEspresso" || appTheme === "catppuccinMocha") return true;
    if (appTheme === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, [appTheme]);

  // Filter terminal-type tabs
  const terminalTabs = useMemo(
    () => tabs.filter((tab) => DOCKVIEW_TAB_TYPES.has(tab.type)) as TabData[],
    [tabs],
  );

  // Sync TabContext → dockview panels
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    syncingRef.current = true;

    const existingPanelIds = new Set(api.panels.map((p) => p.id));
    const tabIds = new Set(terminalTabs.map((t) => String(t.id)));

    // Add new panels
    for (const tab of terminalTabs) {
      const panelId = String(tab.id);
      if (!existingPanelIds.has(panelId)) {
        api.addPanel({
          id: panelId,
          component: tab.type,
          title: tab.title,
          params: {
            tab,
            removeTab,
            updateTab,
            addTab,
            currentTab,
            previewTerminalTheme,
            isTopbarOpen,
            rightSidebarOpen,
            rightSidebarWidth,
          },
        });
      } else {
        // Update params on existing panels
        const panel = api.getPanel(panelId);
        if (panel) {
          panel.api.updateParameters({
            tab,
            removeTab,
            updateTab,
            addTab,
            currentTab,
            previewTerminalTheme,
            isTopbarOpen,
            rightSidebarOpen,
            rightSidebarWidth,
          });
          if (panel.title !== tab.title) {
            panel.api.setTitle(tab.title);
          }
        }
      }
    }

    // Remove panels for closed tabs
    for (const panelId of existingPanelIds) {
      if (!tabIds.has(panelId)) {
        const panel = api.getPanel(panelId);
        if (panel) {
          api.removePanel(panel);
        }
      }
    }

    // Activate the current tab's panel
    if (currentTab) {
      const panel = api.getPanel(String(currentTab));
      if (panel && api.activePanel?.id !== String(currentTab)) {
        panel.api.setActive();
      }
    }

    syncingRef.current = false;
  }, [
    terminalTabs,
    currentTab,
    removeTab,
    updateTab,
    addTab,
    previewTerminalTheme,
    isTopbarOpen,
    rightSidebarOpen,
    rightSidebarWidth,
  ]);

  // Fit terminals when layout changes
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    requestAnimationFrame(() => {
      for (const tab of terminalTabs) {
        if (tab.type === "terminal" && tab.terminalRef?.current?.fit) {
          tab.terminalRef.current.fit();
          tab.terminalRef.current.notifyResize?.();
        }
      }
    });
  }, [isTopbarOpen, sidebarState, rightSidebarOpen, rightSidebarWidth]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;

      // Listen for dockview panel activation → sync to TabContext
      event.api.onDidActivePanelChange((panel) => {
        if (syncingRef.current || !panel) return;
        const tabId = parseInt(panel.id, 10);
        if (!isNaN(tabId) && tabId !== currentTab) {
          setCurrentTab(tabId);
        }
      });

      // Listen for dockview panel close → sync to TabContext
      event.api.onDidRemovePanel((panel) => {
        if (syncingRef.current) return;
        const tabId = parseInt(panel.id, 10);
        if (!isNaN(tabId)) {
          removeTab(tabId);
        }
      });

      // Listen for layout changes → refit terminals
      event.api.onDidLayoutChange(() => {
        requestAnimationFrame(() => {
          for (const tab of terminalTabs) {
            if (tab.type === "terminal" && tab.terminalRef?.current?.fit) {
              tab.terminalRef.current.fit();
              tab.terminalRef.current.notifyResize?.();
            }
          }
        });
      });

      // Add initial panels
      for (const tab of terminalTabs) {
        event.api.addPanel({
          id: String(tab.id),
          component: tab.type,
          title: tab.title,
          params: {
            tab,
            removeTab,
            updateTab,
            addTab,
            currentTab,
            previewTerminalTheme,
            isTopbarOpen,
            rightSidebarOpen,
            rightSidebarWidth,
          },
        });
      }

      // Activate current tab
      if (currentTab) {
        const panel = event.api.getPanel(String(currentTab));
        if (panel) {
          panel.api.setActive();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const topMarginPx = isTopbarOpen ? 74 : 26;
  const leftMarginPx = sidebarState === "collapsed" ? 26 : 8;
  const bottomMarginPx = 8;

  return (
    <div
      className={`border-2 border-edge rounded-lg overflow-hidden ${isDarkMode ? "dockview-theme-dark" : "dockview-theme-light"}`}
      style={{
        marginLeft: leftMarginPx,
        marginRight: rightSidebarOpen
          ? `calc(var(--right-sidebar-width, ${rightSidebarWidth}px) + 8px)`
          : 17,
        marginTop: topMarginPx,
        marginBottom: bottomMarginPx,
        height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
        transition:
          "margin-left 200ms linear, margin-right 200ms linear, margin-top 200ms linear",
      }}
    >
      <DockviewReact
        components={PANEL_COMPONENTS}
        onReady={onReady}
        className="h-full w-full"
      />
    </div>
  );
}
