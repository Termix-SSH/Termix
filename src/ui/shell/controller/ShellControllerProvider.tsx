/* eslint-disable react-refresh/only-export-components */
/* eslint-disable react-hooks/exhaustive-deps */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { isElectron } from "@/lib/electron";
import {
  useConfirm,
  type ConfirmOptions,
} from "@/components/surface/surface-scope";
import type { Host, TabType } from "@/types/ui-types";
import { requestManage } from "@/manage/manage-requests";
import { useRailItems } from "@/sidebar/rail-items";
import { usePanels } from "@/shell/panel-registry";
import {
  getTabType,
  useTabTypes,
  type TabShellCallbacks,
} from "@/shell/tab-registry";
import { usePluginStore } from "@/plugin-host/plugin-store";
import { setShellCallbacks } from "@/plugin-host/shell-bridge";
import {
  createTabStageStore,
  type TabStageStore,
} from "@/shell/stage/tab-stage-store";
import { useRegions } from "./use-regions";
import { useHostList } from "./use-hosts";
import { useTabs } from "./use-tabs";
import { useSplit } from "./use-split";
import { useWorkspaceLayout } from "./use-workspace-layout";
import { useShellKeybindings } from "./use-shell-keybindings";
import { useShellLifecycle } from "./use-shell-lifecycle";
import { publishShellController } from "./shell-store";
import type { ShellController, ShellPalette } from "./types";

const ShellControllerContext = createContext<ShellController | null>(null);
const TabStageContext = createContext<TabStageStore | null>(null);

/** The live shell, for core layout code. Throws outside the shell. */
export function useShellController(): ShellController {
  const controller = useContext(ShellControllerContext);
  if (!controller) throw new Error("useShellController outside the shell");
  return controller;
}

/** The live shell, or null outside it. */
export function useOptionalShellController(): ShellController | null {
  return useContext(ShellControllerContext);
}

export function useTabStageStore(): TabStageStore {
  const store = useContext(TabStageContext);
  if (!store) throw new Error("useTabStageStore outside the shell");
  return store;
}

/**
 * Hands the main area's confirm to code outside it, like closeTab. A layout
 * renders it inside the scope its tab-close questions should show in.
 */
export function ShellConfirmCapture(): null {
  // Optional, so the repair view still draws when the shell itself is broken.
  const controller = useOptionalShellController();
  const confirm = useConfirm();
  if (controller) controller.confirmRef.current = confirm;
  return null;
}

/** Owns every bit of shell state and behaviour a layout draws. */
export function ShellControllerProvider({
  username,
  onLogout,
  children,
}: {
  username: string;
  onLogout: (options?: { manual?: boolean }) => void;
  children: React.ReactNode;
}) {
  // Re-render when plugins add or remove rail items, panels or tabs.
  useRailItems();
  usePanels();
  useTabTypes();
  const { settled: pluginsSettled } = usePluginStore();
  const isMobile = useIsMobile();
  const [stageStore] = useState(createTabStageStore);
  // The root confirm, for questions the shell itself asks (closing a tab).
  const confirmRef = useRef<
    ((options: ConfirmOptions) => Promise<boolean>) | null
  >(null);
  const openSingletonRef = useRef<(type: TabType) => string | undefined>(
    () => undefined,
  );

  const lifecycle = useShellLifecycle({
    onLogout,
    openSingletonTabRef: openSingletonRef,
  });
  const regions = useRegions(isMobile);
  const hosts = useHostList();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const tabsState = useTabs({
    hosts: hosts.list,
    hostsRef: hosts.listRef,
    hostsLoaded: hosts.loaded,
    reloadHosts: hosts.reload,
    userPrefs: lifecycle.userPrefs,
    userPrefsLoaded: lifecycle.userPrefsLoaded,
    pluginsSettled,
    confirmRef,
    layoutDeps: [
      regions.left.view,
      regions.left.open,
      regions.left.width,
      regions.right.view,
      regions.right.width,
    ],
  });
  openSingletonRef.current = tabsState.openSingletonTab;
  const { tabs, activeTabId } = tabsState;

  const palette: ShellPalette = {
    isOpen: paletteOpen,
    open: () => setPaletteOpen(true),
    close: () => setPaletteOpen(false),
    setOpen: setPaletteOpen,
  };

  function editHostInManager(host: Host) {
    requestManage({ kind: "host", hostId: host.id });
    if (isMobile) regions.left.setOpen(false);
  }

  /**
   * What plugins may ask of the shell. Rebuilt every render so it always
   * closes over current state, and published to the plugin runtime.
   */
  const shellCallbacksImpl: TabShellCallbacks = {
    openTab: (host, type, options) => {
      if (!host || getTabType(type)?.singleton) {
        tabsState.openSingletonTab(
          type,
          undefined,
          host ?? undefined,
          options?.data,
          options?.label,
        );
        return;
      }
      tabsState.openTab(host, type, undefined, options);
    },
    openSingletonTab: (type, options) =>
      tabsState.openSingletonTab(type, undefined, undefined, options?.data),
    connectHost: (host, type) => tabsState.connectHost(host, type as TabType),
    closeTab: (tabId) => tabsState.closeTab(tabId),
    renameTab: (tabId, label) => tabsState.renameTab(tabId, label),

    openRailView: (id) => {
      regions.left.setView(id);
      regions.left.setOpen(true);
    },
    closeRailView: (id) => {
      regions.left.setView((prev) => (prev === id ? "hosts" : prev));
      regions.right.setView((prev) => (prev === id ? null : prev));
    },
    openHostEditor: (draft) =>
      requestManage({ kind: "host", hostId: null, draft }),
    saveQuickConnect: tabsState.saveQuickConnectHost,
    confirm: (options) =>
      confirmRef.current ? confirmRef.current(options) : Promise.resolve(false),
  };

  // Tabs get one stable bag that forwards to the latest callbacks, so a shell
  // render does not re-render every open tab.
  const shellImplRef = useRef(shellCallbacksImpl);
  useLayoutEffect(() => {
    shellImplRef.current = shellCallbacksImpl;
  });
  const callbacks = useMemo<TabShellCallbacks>(
    () => ({
      openTab: (...args) => shellImplRef.current.openTab(...args),
      openSingletonTab: (...args) =>
        shellImplRef.current.openSingletonTab(...args),
      connectHost: (...args) => shellImplRef.current.connectHost(...args),
      closeTab: (...args) => shellImplRef.current.closeTab(...args),
      renameTab: (...args) => shellImplRef.current.renameTab(...args),
      openRailView: (...args) => shellImplRef.current.openRailView(...args),
      closeRailView: (...args) => shellImplRef.current.closeRailView(...args),
      openHostEditor: (...args) =>
        shellImplRef.current.openHostEditor?.(...args),
      saveQuickConnect: (...args) =>
        shellImplRef.current.saveQuickConnect!(...args),
      confirm: (...args) => shellImplRef.current.confirm!(...args),
    }),
    [],
  );

  // Panels close the sidebar on mobile after opening something, the same as
  // the hosts panel does.
  const panelCallbacks = useMemo<TabShellCallbacks>(
    () => ({
      ...callbacks,
      openTab: (...args) => {
        callbacks.openTab(...args);
        if (isMobile) regions.left.setOpen(false);
      },
    }),
    [callbacks, isMobile],
  );

  // Resize all terminals in panes + active terminal when split mode or sidebar changes
  const resizeAllTerminals = useCallback(() => {
    const id = requestAnimationFrame(() => {
      tabs.forEach((tab) => {
        if (!tab.terminalRef) return;
        const ref = tab.terminalRef.current;
        ref?.fit?.();
        ref?.notifyResize?.();
      });
    });
    return id;
  }, [tabs]);

  const { split, splitShapeKey, splitActionsRef } = useSplit({
    tabsState,
    isMobile,
    paneEls: stageStore.paneEls,
    callbacks,
    resizeAllTerminals,
  });

  useEffect(() => {
    // Refitting every terminal on each drag frame is what made sidebar drags
    // stutter; fit once when the drag ends instead.
    if (regions.left.dragging || regions.right.dragging) return;
    const id = resizeAllTerminals();
    return () => cancelAnimationFrame(id);
  }, [
    splitShapeKey,
    regions.left.width,
    regions.left.open,
    regions.right.width,
    regions.right.view,
    regions.left.dragging,
    regions.right.dragging,
  ]);

  useWorkspaceLayout(tabsState, regions);
  useShellKeybindings({
    tabsState,
    regions,
    palette,
    splitActionsRef,
    toggleFullscreen: lifecycle.toggleAppFullscreen,
  });

  useEffect(() => {
    setShellCallbacks(callbacks);
  });

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const controller: ShellController = {
    username,
    isAdmin: lifecycle.isAdmin,
    isMobile,
    isElectron: isElectron(),
    pluginsSettled,
    logout: onLogout,
    tabs: {
      list: tabs,
      topLevel: tabs.filter((tab) => !tab.parentSplitTabId),
      activeId: activeTabId,
      active: activeTab,
      ready: tabsState.tabsReady,
      terminalTabs: tabsState.terminalTabs,
      targetTerminal: tabsState.targetTerminalTab,
      showNumbers: tabsState.showTabNumbers,
      background: tabsState.backgroundTabRecords,
      setBackground: tabsState.setBackgroundTabRecords,
      setActive: tabsState.setActiveTabId,
      setList: tabsState.setTabs,
      reorder: tabsState.reorderTopLevelTabs,
      open: tabsState.openTab,
      openSingleton: tabsState.openSingletonTab,
      openMultiInstance: tabsState.openMultiInstanceTab,
      connectHost: tabsState.connectHost,
      close: tabsState.closeTab,
      rename: tabsState.renameTab,
      refresh: tabsState.refreshTab,
      reconnectAll: tabsState.reconnectAllDisconnected,
      handleFor: tabsState.handleFor,
    },
    split,
    hosts: {
      list: hosts.list,
      tree: hosts.tree,
      loading: hosts.loading,
      loaded: hosts.loaded,
      reload: hosts.reload,
      edit: editHostInManager,
    },
    regions,
    palette,
    fullscreen: {
      active: lifecycle.isAppFullscreen,
      toggle: lifecycle.toggleAppFullscreen,
    },
    callbacks,
    panelCallbacks,
    settings: {
      username,
      isAdmin: lifecycle.isAdmin,
      onLogout,
      userPrefs: lifecycle.userPrefs,
      onPrefsChange: (updates) =>
        lifecycle.setUserPrefs((current) => ({ ...current, ...updates })),
      onOpenHostTab: (host: Host) => tabsState.connectHost(host),
    },
    confirmRef,
    resizeAllTerminals,
  };

  useLayoutEffect(() => {
    publishShellController(controller);
  });
  useEffect(() => () => publishShellController(null), []);

  return (
    <TabStageContext.Provider value={stageStore}>
      <ShellControllerContext.Provider value={controller}>
        {children}
      </ShellControllerContext.Provider>
    </TabStageContext.Provider>
  );
}
