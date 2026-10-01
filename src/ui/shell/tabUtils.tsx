/* eslint-disable react-refresh/only-export-components */
import {
  LayoutDashboard,
  LayoutPanelLeft,
  Server,
  Settings,
  User,
} from "lucide-react";
import { lazy, memo, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { Tab, TabType } from "@/types/ui-types";
import { hostToSSHHost } from "@/lib/host-to-ssh-host";
import { PluginViewPlaceholder } from "@/plugin-host/PluginViewPlaceholder";
import {
  getTabType,
  type TabShellCallbacks,
  type TabTypeDef,
} from "./tab-registry";
import { getPanel, type PanelDef } from "./panel-registry";
import {
  markAdaptiveResourceUsed,
  runAdaptiveBackgroundTask,
} from "@/lib/adaptive-resource-budget";

// Heavy tab surfaces — keep out of the AppShell critical path.
const DashboardTab = lazy(() =>
  import("@/dashboard/DashboardTab").then((m) => ({
    default: m.DashboardTab,
  })),
);

/** Download a likely next tab without starting a connection or mounting UI. */
export function preloadTabSurface(type: TabType): void {
  const loader = getTabType(type)?.preload;
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
    case "host-manager":
      return <Server className="size-3.5" />;
    case "user-profile":
      return <User className="size-3.5" />;
    case "admin-settings":
      return <Settings className="size-3.5" />;
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
const RegisteredTab = memo(function RegisteredTab({
  def,
  tab,
  isVisible,
  isFocusedPane,
  inSplit,
  shell,
}: {
  def: TabTypeDef;
  tab: Tab;
  isVisible: boolean;
  isFocusedPane: boolean;
  inSplit: boolean;
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
      inSplit={inSplit}
      handleRef={tab.terminalRef as React.Ref<unknown>}
      shell={shell}
    />
  );
  return withTabSuspense(
    def.panelFrame ? <PanelTabFrame>{content}</PanelTabFrame> : content,
  );
});

const DashboardTabHost = memo(function DashboardTabHost({
  shell,
  isVisible,
}: {
  shell: TabShellCallbacks;
  isVisible: boolean;
}) {
  return withTabSuspense(
    <DashboardTab
      onOpenSingletonTab={(type) => shell.openSingletonTab(type)}
      onOpenTab={(host, type) => shell.openTab(host, type)}
      isVisible={isVisible}
    />,
  );
});

/** A rail panel opened as a tab when its plugin registers no tab of its own. */
const PanelAsTab = memo(function PanelAsTab({
  panel,
  isVisible,
  targetTab,
  shell,
}: {
  panel: PanelDef;
  isVisible: boolean;
  targetTab?: Tab;
  shell: TabShellCallbacks;
}) {
  const Panel = panel.component;
  return withTabSuspense(
    <PanelTabFrame>
      <Panel
        targetTab={targetTab}
        active={isVisible}
        shell={shell}
        setEditing={noop}
        placement="tab"
      />
    </PanelTabFrame>,
  );
});

function noop() {}

export interface TabRenderContext {
  shell: TabShellCallbacks;
  /** The terminal a panel shown as a tab sends commands to. */
  panelTargetTab?: Tab;
  isVisible?: boolean;
  isFocusedPane?: boolean;
  inSplit?: boolean;
}

export function renderTabContent(tab: Tab, context: TabRenderContext) {
  const {
    shell,
    isVisible = true,
    isFocusedPane = true,
    inSplit = false,
  } = context;

  switch (tab.type) {
    case "dashboard":
      return <DashboardTabHost shell={shell} isVisible={isVisible} />;

    case "split-screen":
      return null;

    case "host-manager":
    case "user-profile":
    case "admin-settings":
      return null;

    default: {
      const def = getTabType(tab.type);
      if (!def) {
        const panel = getPanel(tab.type);
        if (panel) {
          return (
            <PanelAsTab
              panel={panel}
              isVisible={isVisible}
              targetTab={context.panelTargetTab}
              shell={shell}
            />
          );
        }
        return <PluginViewPlaceholder kind="tab" viewId={tab.type} />;
      }
      return (
        <RegisteredTab
          def={def}
          tab={tab}
          isVisible={isVisible}
          isFocusedPane={isFocusedPane}
          inSplit={inSplit}
          shell={shell}
        />
      );
    }
  }
}
