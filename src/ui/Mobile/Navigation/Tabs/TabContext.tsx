import React, {
  createContext,
  useContext,
  useState,
  useRef,
  type ReactNode,
} from "react";
import type { TabContextTab } from "../../../types/index.js";

export type Tab = TabContextTab;

interface TabContextType {
  tabs: Tab[];
  currentTab: number | null;
  addTab: (tab: Omit<Tab, "id">) => number;
  removeTab: (tabId: number) => void;
  setCurrentTab: (tabId: number) => void;
  getTab: (tabId: number) => Tab | undefined;
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
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [currentTab, setCurrentTab] = useState<number | null>(null);
  const nextTabId = useRef(1);

  function computeUniqueTitle(desiredTitle: string | undefined): string {
    const baseTitle = (desiredTitle || "Terminal").trim();
    const existingTitles = tabs.map((t) => t.title);
    if (!existingTitles.includes(baseTitle)) {
      return baseTitle;
    }
    let i = 2;
    while (existingTitles.includes(`${baseTitle} (${i})`)) {
      i++;
    }
    return `${baseTitle} (${i})`;
  }

  const addTab = (tabData: Omit<Tab, "id">): number => {
    const id = nextTabId.current++;
    const newTab: Tab = {
      ...tabData,
      id,
      title: computeUniqueTitle(tabData.title),
      terminalRef: React.createRef<any>(),
    };
    setTabs((prev) => [...prev, newTab]);
    setCurrentTab(id);
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

    setTabs((prev) => {
      const newTabs = prev.filter((tab) => tab.id !== tabId);
      if (currentTab === tabId) {
        setCurrentTab(
          newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null,
        );
      }
      return newTabs;
    });
  };

  const getTab = (tabId: number) => {
    return tabs.find((tab) => tab.id === tabId);
  };

  const value: TabContextType = {
    tabs,
    currentTab,
    addTab,
    removeTab,
    setCurrentTab,
    getTab,
  };

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}
