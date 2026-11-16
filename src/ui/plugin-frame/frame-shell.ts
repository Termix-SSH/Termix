/**
 * useShell inside a plugin frame: a read only view of the shell (tabs,
 * splits, theme, mobile or not) built from the state the shell pushes.
 * Moving around goes through the frame's checked tab calls. Anything that
 * would change the shell for other plugins (closing their tabs, docks,
 * logging out) is not there.
 */

import { useMemo } from "react";
import type {
  ShellController,
  ShellTabState,
  TabsApi,
} from "@termix-ssh/plugin-sdk/frontend";
import { useFrameState } from "./frame-store";

const noop = () => {};

export function useFrameShell(
  tabs: TabsApi,
  show: (id: string) => void,
): ShellController {
  const list = useFrameState((state) => state.tabs);
  const ready = useFrameState((state) => state.tabsReady);
  const activeId = useFrameState((state) => state.activeTabId ?? "");
  const splits = useFrameState((state) => state.splits);
  const isMobile = useFrameState((state) => state.isMobile);
  const desktop = useFrameState((state) => state.desktop.available);
  const user = useFrameState((state) => state.user);
  const permissions = useFrameState((state) => state.permissions);
  const hosts = useFrameState((state) => state.hosts);
  const hostsLoaded = useFrameState((state) => state.hostsLoaded);
  const theme = useFrameState((state) => state.theme.mode);

  return useMemo(() => {
    const tabList = list as unknown as ShellTabState[];
    const inSplit = new Set(
      (splits ?? []).flatMap((split) =>
        split.panes.map((pane) => pane.tabId).filter(Boolean),
      ),
    );
    const shell = {
      framed: true,
      theme,
      tabs: {
        list: tabList,
        topLevel: tabList.filter((tab) => !inSplit.has(tab.id)),
        activeId,
        ready,
        showNumbers: false,
        setActive: show,
        reorder: noop,
        close: async (id: string) => tabs.closeTab(id),
        rename: noop,
        refresh: noop,
        reconnectAll: noop,
        openSingleton: (type: string) => {
          tabs.openSingletonTab(type);
          return undefined;
        },
      },
      split: {
        activeId: null,
        focusedPaneId: null,
        summaries: splits ?? [],
        activeFull: false,
        handleAction: noop,
      },
      hosts: {
        list: hosts,
        loading: !hostsLoaded,
        loaded: hostsLoaded,
        reload: async () => {},
      },
      palette: { isOpen: false, open: noop, close: noop },
      fullscreen: { active: false, toggle: noop },
      env: {
        isMobile,
        isElectron: desktop,
        user: { username: user?.username ?? "", isAdmin: !!user?.isAdmin },
        permissions,
        branding: { appName: null, tagline: null, logo: null },
      },
      logout: noop,
    };
    return shell as unknown as ShellController;
  }, [
    list,
    ready,
    activeId,
    splits,
    isMobile,
    desktop,
    user,
    permissions,
    hosts,
    hostsLoaded,
    theme,
    tabs,
    show,
  ]);
}
