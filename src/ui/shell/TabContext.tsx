/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { TabContextTab, TerminalRefHandle } from "@/types/index";

export type Tab = TabContextTab;

interface TabContextType {
  tabs: Tab[];
  currentTab: number | null;
  allSplitScreenTab: number[];
  addTab: (tab: Omit<Tab, "id">) => number;
  removeTab: (tabId: number) => void;
  setCurrentTab: (tabId: number) => void;
  setSplitScreenTab: (tabId: number) => void;
  getTab: (tabId: number) => Tab | undefined;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateHostConfig: (
    hostId: number,
    newHostConfig: {
      id: number;
      name?: string;
      username: string;
      ip: string;
      port: number;
    },
  ) => void;
  updateTab: (tabId: number, updates: Partial<Omit<Tab, "id">>) => void;
  previewTerminalTheme: string | null;
  setPreviewTerminalTheme: (theme: string | null) => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export function useTabs() {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error("useTabs must be used within a TabProvider");
  }
  return context;
}

const NOOP_TABS: TabContextType = {
  tabs: [],
  currentTab: null,
  allSplitScreenTab: [],
  addTab: () => -1,
  removeTab: () => {},
  setCurrentTab: () => {},
  setSplitScreenTab: () => {},
  getTab: () => undefined,
  reorderTabs: () => {},
  updateHostConfig: () => {},
  updateTab: () => {},
  previewTerminalTheme: null,
  setPreviewTerminalTheme: () => {},
};

export function useTabsSafe(): TabContextType {
  return useContext(TabContext) ?? NOOP_TABS;
}

interface TabProviderProps {
  children: ReactNode;
}

export function clearTermixSessionStorage() {
  localStorage.removeItem("termix_tabs");
  localStorage.removeItem("termix_currentTab");
}

export function TabProvider({ children }: TabProviderProps) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 1, type: "home", title: "Home" },
  ]);
  const [currentTab, setCurrentTab] = useState<number>(1);
  const [allSplitScreenTab, setAllSplitScreenTab] = useState<number[]>([]);
  const [previewTerminalTheme, setPreviewTerminalTheme] = useState<
    string | null
  >(null);
  const [initialMaxId] = useState(2);
  const nextTabId = useRef(initialMaxId);

  // Safety net: if currentTab points to a tab that no longer exists, fall back to home
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === currentTab)) {
      setCurrentTab(1);
    }
  }, [tabs, currentTab]);

  React.useEffect(() => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === 1 && tab.type === "home"
          ? { ...tab, title: t("nav.home") }
          : tab,
      ),
    );
  }, [t]);

  const computeUniqueTitle = useCallback(
    (tabType: Tab["type"], desiredTitle: string | undefined): string => {
      const defaultTitle =
        tabType === "server_stats"
          ? t("nav.hostMetrics")
          : tabType === "file_manager"
            ? t("nav.fileManager")
            : tabType === "tunnel"
              ? t("nav.tunnels")
              : tabType === "docker"
                ? t("nav.docker")
                : t("nav.terminal");
      const baseTitle = (desiredTitle || defaultTitle).trim();
      const match = baseTitle.match(/^(.*) \((\d+)\)$/);
      const root = match ? match[1] : baseTitle;

      const usedNumbers = new Set<number>();
      let rootUsed = false;
      tabs.forEach((t) => {
        if (!t.title) return;
        if (t.title === root) {
          rootUsed = true;
          return;
        }
        const m = t.title.match(
          new RegExp(
            `^${root.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")} \\((\\d+)\\)$`,
          ),
        );
        if (m) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n)) usedNumbers.add(n);
        }
      });

      if (!rootUsed) return root;
      let n = 2;
      while (usedNumbers.has(n)) n += 1;
      return `${root} (${n})`;
    },
    [t, tabs],
  );

  const addTab = useCallback(
    (tabData: Omit<Tab, "id">): number => {
      // --- tmux-monitor --- (tmux_monitor is a singleton tab like ssh_manager:
      // re-opening focuses the existing tab instead of adding a duplicate)
      if (tabData.type === "ssh_manager" || tabData.type === "tmux_monitor") {
        const existingTab = tabs.find((t) => t.type === tabData.type);
        if (existingTab) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === existingTab.id
                ? {
                    ...t,
                    title: existingTab.title,
                    hostConfig: tabData.hostConfig
                      ? { ...tabData.hostConfig }
                      : undefined,
                    initialTab: tabData.initialTab,
                    _updateTimestamp: Date.now(),
                  }
                : t,
            ),
          );
          setCurrentTab(existingTab.id);
          setAllSplitScreenTab((prev) =>
            prev.filter((tid) => tid !== existingTab.id),
          );
          return existingTab.id;
        }
      }

      const id = nextTabId.current++;
      const instanceId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const needsUniqueTitle =
        tabData.type === "terminal" ||
        tabData.type === "server_stats" ||
        tabData.type === "file_manager" ||
        tabData.type === "tunnel" ||
        tabData.type === "docker";
      const effectiveTitle = needsUniqueTitle
        ? computeUniqueTitle(tabData.type, tabData.title)
        : tabData.type === "tmux_monitor" // --- tmux-monitor ---
          ? tabData.title || t("nav.tmuxMonitor")
          : tabData.title || "";
      const newTab: Tab = {
        ...tabData,
        id,
        instanceId,
        title: effectiveTitle,
        terminalRef:
          tabData.type === "terminal"
            ? React.createRef<TerminalRefHandle>()
            : undefined,
        hostConfig: tabData.hostConfig
          ? {
              ...tabData.hostConfig,
              instanceId,
            }
          : undefined,
      };
      setTabs((prev) => [...prev, newTab]);
      setCurrentTab(id);
      setAllSplitScreenTab((prev) => prev.filter((tid) => tid !== id));
      return id;
    },
    [computeUniqueTitle, tabs, t], // --- tmux-monitor --- (added t)
  );

  const pendingCurrentTabRef = useRef<number | null>(null);

  const removeTab = useCallback(
    (tabId: number) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (
        tab &&
        tab.terminalRef?.current &&
        typeof tab.terminalRef.current.disconnect === "function"
      ) {
        tab.terminalRef.current.disconnect();
      }

      setTabs((prev) => {
        const closedIndex = prev.findIndex((t) => t.id === tabId);
        const filtered = prev.filter((t) => t.id !== tabId);

        if (filtered.length === 0) {
          pendingCurrentTabRef.current = 1;
          return [{ id: 1, type: "home", title: t("nav.home") }];
        }

        // If the closed tab was active, compute the next tab to activate
        // using the latest prev so rapid closes don't use stale data
        const nextIndex =
          closedIndex < filtered.length ? closedIndex : filtered.length - 1;
        pendingCurrentTabRef.current =
          filtered[Math.max(0, nextIndex)]?.id ?? 1;

        return filtered;
      });

      setAllSplitScreenTab((prev) => {
        const newSplits = prev.filter((id) => id !== tabId);
        return newSplits.length <= 1 ? [] : newSplits;
      });

      setCurrentTab((prevCurrentTab) => {
        if (prevCurrentTab !== tabId) return prevCurrentTab;
        return pendingCurrentTabRef.current ?? 1;
      });
    },
    [t, tabs],
  );

  const setSplitScreenTab = useCallback((tabId: number) => {
    setAllSplitScreenTab((prev) => {
      if (prev.includes(tabId)) {
        return prev.filter((id) => id !== tabId);
      } else if (prev.length < 6) {
        return [...prev, tabId];
      }
      return prev;
    });
  }, []);

  const getTab = useCallback(
    (tabId: number) => {
      return tabs.find((tab) => tab.id === tabId);
    },
    [tabs],
  );

  const isReorderingRef = useRef(false);

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    if (isReorderingRef.current) return;

    isReorderingRef.current = true;

    setTabs((prev) => {
      const newTabs = [...prev];
      const [movedTab] = newTabs.splice(fromIndex, 1);

      const maxIndex = newTabs.length;
      const safeToIndex = Math.min(toIndex, maxIndex);

      newTabs.splice(safeToIndex, 0, movedTab);

      setTimeout(() => {
        isReorderingRef.current = false;
      }, 100);

      return newTabs;
    });
  }, []);

  const updateHostConfig = useCallback(
    (
      hostId: number,
      newHostConfig: {
        id: number;
        name?: string;
        username: string;
        ip: string;
        port: number;
      },
    ) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.hostConfig && tab.hostConfig.id === hostId) {
            if (tab.type === "ssh_manager") {
              return {
                ...tab,
                hostConfig: {
                  ...newHostConfig,
                  instanceId: tab.hostConfig.instanceId,
                },
              };
            }

            return {
              ...tab,
              hostConfig: {
                ...newHostConfig,
                instanceId: tab.hostConfig.instanceId,
              },
              title: newHostConfig.name?.trim()
                ? newHostConfig.name
                : t("nav.hostTabTitle", {
                    username: newHostConfig.username,
                    ip: newHostConfig.ip,
                    port: newHostConfig.port,
                  }),
            };
          }
          return tab;
        }),
      );
    },
    [t],
  );

  const updateTab = useCallback(
    (tabId: number, updates: Partial<Omit<Tab, "id">>) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId
            ? { ...tab, ...updates, _updateTimestamp: Date.now() }
            : tab,
        ),
      );
    },
    [],
  );

  const value: TabContextType = useMemo(
    () => ({
      tabs,
      currentTab,
      allSplitScreenTab,
      addTab,
      removeTab,
      setCurrentTab,
      setSplitScreenTab,
      getTab,
      reorderTabs,
      updateHostConfig,
      updateTab,
      previewTerminalTheme,
      setPreviewTerminalTheme,
    }),
    [
      tabs,
      currentTab,
      allSplitScreenTab,
      addTab,
      removeTab,
      setSplitScreenTab,
      getTab,
      reorderTabs,
      updateHostConfig,
      updateTab,
      previewTerminalTheme,
      setPreviewTerminalTheme,
    ],
  );

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}
