import { useMemo } from "react";
import type {
  PluginHostRecord,
  ShellController as PluginShellController,
  ShellTabState,
} from "@termix-ssh/plugin-sdk/frontend";
import { usePermissions } from "@/hooks/use-permissions";
import { useBranding } from "@/contexts/BrandingContext";
import { useRailItems } from "@/sidebar/rail-items";
import { usePanels } from "@/shell/panel-registry";
import { useTabTypes } from "@/shell/tab-registry";
import { useRegisteredDashboardCards as useDashboardCards } from "@/dashboard/dashboard-cards-registry";
import type { TabSplitAction } from "@/shell/split/split-tabs";
import { toPluginHostRecord } from "@/plugin-host/bridge";
import { useOptionalShellController } from "./ShellControllerProvider";
import { useShellSnapshot } from "./shell-store";

const registries: PluginShellController["registries"] = {
  useRailItems: () =>
    useRailItems() as unknown as ReturnType<
      PluginShellController["registries"]["useRailItems"]
    >,
  usePanels: () =>
    usePanels() as unknown as ReturnType<
      PluginShellController["registries"]["usePanels"]
    >,
  useTabTypes: () =>
    useTabTypes() as unknown as ReturnType<
      PluginShellController["registries"]["useTabTypes"]
    >,
  useDashboardCards: () =>
    useDashboardCards() as unknown as ReturnType<
      PluginShellController["registries"]["useDashboardCards"]
    >,
};

/**
 * The shell as a plugin layout sees it, through useShell() in the SDK. Inside
 * the shell this reads the controller's context; outside (an overlay a
 * plugin mounted elsewhere) the last published one.
 */
export function usePluginShell(pluginId: string): PluginShellController | null {
  const fromContext = useOptionalShellController();
  const published = useShellSnapshot();
  const shell = fromContext ?? published;
  const { permissions } = usePermissions();
  const branding = useBranding();

  const hosts = shell?.hosts.list;
  const hostRecords = useMemo<PluginHostRecord[]>(
    () => (hosts ?? []).map((host) => toPluginHostRecord(host, pluginId)),
    [hosts, pluginId],
  );
  // The shell always keeps a home tab. A layout that registers no tab type
  // for it never sees it, so it has no dead tab to draw.
  const hasHome = useTabTypes().some((type) => type.id === "dashboard");

  if (!shell) return null;
  const { tabs, split, regions } = shell;
  const shown = (list: typeof tabs.list) =>
    (hasHome
      ? list
      : list.filter(
          (tab) => tab.type !== "dashboard",
        )) as unknown as ShellTabState[];
  return {
    tabs: {
      list: shown(tabs.list),
      topLevel: shown(tabs.topLevel),
      activeId: tabs.activeId,
      ready: tabs.ready,
      showNumbers: tabs.showNumbers,
      setActive: tabs.setActive,
      reorder: (next) => tabs.reorder(next as unknown as typeof tabs.topLevel),
      close: tabs.close,
      rename: tabs.rename,
      refresh: tabs.refresh,
      reconnectAll: tabs.reconnectAll,
      openSingleton: (type) => tabs.openSingleton(type),
    },
    split: {
      activeId: split.active?.id ?? null,
      focusedPaneId: split.focusedPaneId,
      summaries: split.summaries,
      activeFull: split.activeFull,
      handleAction: (action) =>
        split.handleAction(action as unknown as TabSplitAction),
    },
    hosts: {
      list: hostRecords,
      loading: shell.hosts.loading,
      loaded: shell.hosts.loaded,
      reload: shell.hosts.reload,
    },
    regions: {
      left: {
        ...regions.left,
        setView: (view) => regions.left.setView(view ?? "hosts"),
        startResize: (event) =>
          regions.left.startResize(event as unknown as React.MouseEvent),
      },
      right: {
        ...regions.right,
        editing: false,
        setView: (view) => regions.right.setView(view),
        startResize: (event) =>
          regions.right.startResize(event as unknown as React.MouseEvent),
      } as PluginShellController["regions"]["right"],
      railClick: regions.railClick,
      openInRightDock: regions.openInRightDock,
      toggleRightDock: regions.toggleRightDock,
    },
    palette: {
      isOpen: shell.palette.isOpen,
      open: shell.palette.open,
      close: shell.palette.close,
    },
    fullscreen: shell.fullscreen,
    actions: shell.callbacks as unknown as PluginShellController["actions"],
    env: {
      isMobile: shell.isMobile,
      isElectron: shell.isElectron,
      user: { username: shell.username, isAdmin: shell.isAdmin },
      permissions,
      branding: {
        appName: branding.appName || null,
        tagline: branding.tagline || null,
        logo: branding.logo,
      },
    },
    registries,
    logout: shell.logout,
  };
}
