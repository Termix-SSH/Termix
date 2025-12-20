import React, {
  createContext,
  useContext,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { TabContextTab } from "../../../types/index.js";

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
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export function useTabs() {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error("useTabs must be used within a TabProvider");
  }
  return context;
}

interface TabProviderProps {
  children: ReactNode;
}

export function TabProvider({ children }: TabProviderProps) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>(() => [
    { id: 1, type: "home", title: "Home" },
  ]);
  const [currentTab, setCurrentTab] = useState<number>(1);
  const [allSplitScreenTab, setAllSplitScreenTab] = useState<number[]>([]);
  const nextTabId = useRef(2);

  // Update home tab title when translation changes
  React.useEffect(() => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === 1 && tab.type === "home"
          ? { ...tab, title: t("nav.home") }
          : tab,
      ),
    );
  }, [t]);

  function computeUniqueTitle(
    tabType: Tab["type"],
    desiredTitle: string | undefined,
  ): string {
    const defaultTitle =
      tabType === "server"
        ? t("nav.serverStats")
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
  }

  const addTab = (tabData: Omit<Tab, "id">): number => {
    if (tabData.type === "ssh_manager") {
      const existingTab = tabs.find((t) => t.type === "ssh_manager");
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
    const needsUniqueTitle =
      tabData.type === "terminal" ||
      tabData.type === "server" ||
      tabData.type === "file_manager" ||
      tabData.type === "tunnel" ||
      tabData.type === "docker";
    const effectiveTitle = needsUniqueTitle
      ? computeUniqueTitle(tabData.type, tabData.title)
      : tabData.title || "";
    const newTab: Tab = {
      ...tabData,
      id,
      title: effectiveTitle,
      terminalRef:
        tabData.type === "terminal"
          ? React.createRef<{ disconnect?: () => void }>()
          : undefined,
    };
    setTabs((prev) => [...prev, newTab]);
    setCurrentTab(id);
    setAllSplitScreenTab((prev) => prev.filter((tid) => tid !== id));
    return id;
  };

  const removeTab = (tabId: number) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (
      tab &&
      tab.terminalRef?.current &&
      typeof tab.terminalRef.current.disconnect === "function"
    ) {
      tab.terminalRef.current.disconnect();
    }

    setTabs((prev) => prev.filter((tab) => tab.id !== tabId));

    // Remove from split screen
    setAllSplitScreenTab((prev) => {
      const newSplits = prev.filter((id) => id !== tabId);
      // Auto-clear split mode if only 1 or fewer tabs remain in split
      if (newSplits.length <= 1) {
        return [];
      }
      return newSplits;
    });

    if (currentTab === tabId) {
      const remainingTabs = tabs.filter((tab) => tab.id !== tabId);
      if (remainingTabs.length > 0) {
        // Try to set current tab to another split tab first, if any remain
        const remainingSplitTabs = allSplitScreenTab.filter(
          (id) => id !== tabId,
        );
        if (remainingSplitTabs.length > 0) {
          setCurrentTab(remainingSplitTabs[0]);
        } else {
          setCurrentTab(remainingTabs[0].id);
        }
      } else {
        setCurrentTab(1); // Home tab
      }
    }
  };

  const setSplitScreenTab = (tabId: number) => {
    setAllSplitScreenTab((prev) => {
      if (prev.includes(tabId)) {
        return prev.filter((id) => id !== tabId);
      } else if (prev.length < 4) {
        return [...prev, tabId];
      }
      return prev;
    });
  };

  const getTab = (tabId: number) => {
    return tabs.find((tab) => tab.id === tabId);
  };

  const isReorderingRef = useRef(false);

  const reorderTabs = (fromIndex: number, toIndex: number) => {
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
  };

  const updateHostConfig = (
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
              hostConfig: newHostConfig,
            };
          }

          return {
            ...tab,
            hostConfig: newHostConfig,
            title: newHostConfig.name?.trim()
              ? newHostConfig.name
              : `${newHostConfig.username}@${newHostConfig.ip}:${newHostConfig.port}`,
          };
        }
        return tab;
      }),
    );
  };

  const updateTab = (tabId: number, updates: Partial<Omit<Tab, "id">>) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, ...updates } : tab)),
    );
  };

  const value: TabContextType = {
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
  };

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}
