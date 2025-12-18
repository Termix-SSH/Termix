import React, { useState } from "react";
import { flushSync } from "react-dom";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ChevronDown, ChevronUpIcon, Hammer } from "lucide-react";
import { Tab } from "@/ui/desktop/navigation/tabs/Tab.tsx";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { useTranslation } from "react-i18next";
import { TabDropdown } from "@/ui/desktop/navigation/tabs/TabDropdown.tsx";
import { SSHToolsSidebar } from "@/ui/desktop/apps/tools/SSHToolsSidebar.tsx";
import { useCommandHistory } from "@/ui/desktop/apps/terminal/command-history/CommandHistoryContext.tsx";

interface TabData {
  id: number;
  type: string;
  title: string;
  terminalRef?: {
    current?: {
      sendInput?: (data: string) => void;
    };
  };
  [key: string]: unknown;
}

interface TopNavbarProps {
  isTopbarOpen: boolean;
  setIsTopbarOpen: (open: boolean) => void;
  onOpenCommandPalette: () => void;
  onRightSidebarStateChange?: (isOpen: boolean, width: number) => void;
}

export function TopNavbar({
  isTopbarOpen,
  setIsTopbarOpen,
  onOpenCommandPalette,
  onRightSidebarStateChange,
}: TopNavbarProps): React.ReactElement {
  const { state } = useSidebar();
  const {
    tabs,
    currentTab,
    setCurrentTab,
    setSplitScreenTab,
    removeTab,
    allSplitScreenTab,
    reorderTabs,
  } = useTabs() as {
    tabs: TabData[];
    currentTab: number;
    setCurrentTab: (id: number) => void;
    setSplitScreenTab: (id: number) => void;
    removeTab: (id: number) => void;
    allSplitScreenTab: number[];
    reorderTabs: (fromIndex: number, toIndex: number) => void;
  };
  const leftPosition =
    state === "collapsed" ? "26px" : "calc(var(--sidebar-width) + 8px)";
  const { t } = useTranslation();
  const commandHistory = useCommandHistory();

  const [toolsSidebarOpen, setToolsSidebarOpen] = useState(false);
  const [commandHistoryTabActive, setCommandHistoryTabActive] = useState(false);
  const [splitScreenTabActive, setSplitScreenTabActive] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("rightSidebarWidth");
    const defaultWidth = 400;
    const savedWidth = saved !== null ? parseInt(saved, 10) : defaultWidth;
    const minWidth = Math.min(300, Math.floor(window.innerWidth * 0.2));
    const maxWidth = Math.floor(window.innerWidth * 0.3);
    return Math.min(savedWidth, Math.max(minWidth, maxWidth));
  });

  React.useEffect(() => {
    localStorage.setItem("rightSidebarWidth", String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  React.useEffect(() => {
    const handleResize = () => {
      const minWidth = Math.min(300, Math.floor(window.innerWidth * 0.2));
      const maxWidth = Math.floor(window.innerWidth * 0.3);
      if (rightSidebarWidth > maxWidth) {
        setRightSidebarWidth(Math.max(minWidth, maxWidth));
      } else if (rightSidebarWidth < minWidth) {
        setRightSidebarWidth(minWidth);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [rightSidebarWidth]);

  React.useEffect(() => {
    if (onRightSidebarStateChange) {
      onRightSidebarStateChange(toolsSidebarOpen, rightSidebarWidth);
    }
  }, [toolsSidebarOpen, rightSidebarWidth, onRightSidebarStateChange]);

  const openCommandHistorySidebar = React.useCallback(() => {
    setToolsSidebarOpen(true);
    setCommandHistoryTabActive(true);
  }, []);

  React.useEffect(() => {
    commandHistory.setOpenCommandHistory(openCommandHistorySidebar);
  }, [commandHistory, openCommandHistorySidebar]);

  const rightPosition = toolsSidebarOpen
    ? `calc(var(--right-sidebar-width, ${rightSidebarWidth}px) + 8px)`
    : "17px";
  const [justDroppedTabId, setJustDroppedTabId] = useState<number | null>(null);
  const [isInDropAnimation, setIsInDropAnimation] = useState(false);
  const [dragState, setDragState] = useState<{
    draggedId: number | null;
    draggedIndex: number | null;
    currentX: number;
    startX: number;
    targetIndex: number | null;
  }>({
    draggedId: null,
    draggedIndex: null,
    currentX: 0,
    startX: 0,
    targetIndex: null,
  });
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const tabRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
  const isProcessingDropRef = React.useRef(false);

  const prevTabsRef = React.useRef<TabData[]>([]);

  const handleTabActivate = (tabId: number) => {
    setCurrentTab(tabId);
  };

  const handleTabSplit = (tabId: number) => {
    setToolsSidebarOpen(true);
    setCommandHistoryTabActive(false);
    setSplitScreenTabActive(true);
  };

  const handleTabClose = (tabId: number) => {
    removeTab(tabId);
  };

  const handleSnippetExecute = (content: string) => {
    const tab = tabs.find((t: TabData) => t.id === currentTab);
    if (tab?.terminalRef?.current?.sendInput) {
      tab.terminalRef.current.sendInput(content + "\n");
    }
  };

  React.useEffect(() => {
    if (prevTabsRef.current.length > 0 && tabs !== prevTabsRef.current) {
      prevTabsRef.current = [];
    }
  }, [tabs]);

  React.useEffect(() => {
    if (justDroppedTabId !== null) {
      const timer = setTimeout(() => setJustDroppedTabId(null), 50);
      return () => clearTimeout(timer);
    }
  }, [justDroppedTabId]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    const img = new Image();
    img.src =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    e.dataTransfer.setDragImage(img, 0, 0);

    setDragState({
      draggedId: tabs[index].id,
      draggedIndex: index,
      startX: e.clientX,
      currentX: e.clientX,
      targetIndex: index,
    });
  };

  const handleDrag = (e: React.DragEvent) => {
    if (e.clientX === 0) return;
    if (dragState.draggedIndex === null) return;

    setDragState((prev) => ({
      ...prev,
      currentX: e.clientX,
    }));
  };

  const calculateTargetIndex = () => {
    if (!containerRef.current || dragState.draggedIndex === null) return null;

    const draggedIndex = dragState.draggedIndex;

    const tabBoundaries: {
      index: number;
      start: number;
      end: number;
      mid: number;
    }[] = [];
    let accumulatedX = 0;

    tabs.forEach((tab, i) => {
      const tabEl = tabRefs.current.get(i);
      if (!tabEl) return;

      const tabWidth = tabEl.getBoundingClientRect().width;
      tabBoundaries.push({
        index: i,
        start: accumulatedX,
        end: accumulatedX + tabWidth,
        mid: accumulatedX + tabWidth / 2,
      });
      accumulatedX += tabWidth + 4;
    });

    if (tabBoundaries.length === 0) return null;

    const containerRect = containerRef.current.getBoundingClientRect();
    const draggedTab = tabBoundaries[draggedIndex];
    const currentX = dragState.currentX - containerRect.left;
    const startX = dragState.startX - containerRect.left;
    const offset = currentX - startX;
    const draggedCenter = draggedTab.mid + offset;

    let newTargetIndex = draggedIndex;

    if (offset < 0) {
      for (let i = draggedIndex - 1; i >= 0; i--) {
        if (draggedCenter < tabBoundaries[i].mid) {
          newTargetIndex = i;
        } else {
          break;
        }
      }
    } else if (offset > 0) {
      for (let i = draggedIndex + 1; i < tabBoundaries.length; i++) {
        if (draggedCenter > tabBoundaries[i].mid) {
          newTargetIndex = i;
        } else {
          break;
        }
      }
      const lastTabIndex = tabBoundaries.length - 1;
      if (lastTabIndex >= 0) {
        const lastTabEl = tabRefs.current.get(lastTabIndex);
        if (lastTabEl) {
          const lastTabRect = lastTabEl.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();
          const lastTabEndInContainer = lastTabRect.right - containerRect.left;
          if (currentX > lastTabEndInContainer) {
            newTargetIndex = lastTabIndex;
          }
        }
      }
    }

    return newTargetIndex;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    if (dragState.draggedIndex === null) return;

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    if (e.clientX !== 0) {
      setDragState((prev) => ({
        ...prev,
        currentX: e.clientX,
      }));
    }

    const newTargetIndex = calculateTargetIndex();
    if (newTargetIndex !== null && newTargetIndex !== dragState.targetIndex) {
      setDragState((prev) => ({
        ...prev,
        targetIndex: newTargetIndex,
      }));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    if (isProcessingDropRef.current) return;
    isProcessingDropRef.current = true;

    const fromIndex = dragState.draggedIndex;
    const toIndex = dragState.targetIndex;
    const draggedId = dragState.draggedId;

    if (fromIndex !== null && toIndex !== null && fromIndex !== toIndex) {
      prevTabsRef.current = tabs;

      flushSync(() => {
        setIsInDropAnimation(true);
        setDragState({
          draggedId: null,
          draggedIndex: null,
          startX: 0,
          currentX: 0,
          targetIndex: null,
        });
      });

      reorderTabs(fromIndex, toIndex);

      if (draggedId !== null) {
        setJustDroppedTabId(draggedId);
      }
    } else {
      setDragState({
        draggedId: null,
        draggedIndex: null,
        startX: 0,
        currentX: 0,
        targetIndex: null,
      });
    }

    setTimeout(() => {
      isProcessingDropRef.current = false;
      setIsInDropAnimation(false);
    }, 50);
  };

  const handleDragEnd = () => {
    setIsInDropAnimation(false);
    setDragState({
      draggedId: null,
      draggedIndex: null,
      startX: 0,
      currentX: 0,
      targetIndex: null,
    });
  };

  const isSplitScreenActive =
    Array.isArray(allSplitScreenTab) && allSplitScreenTab.length > 0;
  const currentTabObj = tabs.find((t: TabData) => t.id === currentTab);
  const currentTabIsHome = currentTabObj?.type === "home";
  const currentTabIsSshManager = currentTabObj?.type === "ssh_manager";
  const currentTabIsAdmin = currentTabObj?.type === "admin";
  const currentTabIsUserProfile = currentTabObj?.type === "user_profile";

  return (
    <div>
      <div
        className="fixed z-10 h-[50px] border-2 border-dark-border rounded-lg flex flex-row transform-none m-0 p-0"
        style={{
          top: isTopbarOpen ? "0.5rem" : "-3rem",
          left: leftPosition,
          right: rightPosition,
          backgroundColor: "#18181b",
          transition: "top 200ms linear, left 200ms linear, right 200ms linear",
        }}
      >
        <div
          ref={containerRef}
          className="h-full p-1 pr-2 border-r-2 border-dark-border w-[calc(100%-6rem)] flex items-center overflow-x-auto overflow-y-hidden skinny-scrollbar gap-1"
        >
          {tabs.map((tab: TabData, index: number) => {
            const isActive = tab.id === currentTab;
            const isSplit =
              Array.isArray(allSplitScreenTab) &&
              allSplitScreenTab.includes(tab.id);
            const isTerminal = tab.type === "terminal";
            const isServer = tab.type === "server";
            const isFileManager = tab.type === "file_manager";
            const isTunnel = tab.type === "tunnel";
            const isDocker = tab.type === "docker";
            const isSshManager = tab.type === "ssh_manager";
            const isAdmin = tab.type === "admin";
            const isUserProfile = tab.type === "user_profile";
            const isSplittable =
              isTerminal || isServer || isFileManager || isTunnel || isDocker;
            const disableSplit = !isSplittable;
            const disableActivate =
              isSplit ||
              ((tab.type === "home" ||
                tab.type === "ssh_manager" ||
                tab.type === "admin" ||
                tab.type === "user_profile") &&
                isSplitScreenActive);
            const isHome = tab.type === "home";
            const disableClose = isHome;

            const isDraggingThisTab = dragState.draggedIndex === index;
            const isTheDraggedTab = tab.id === dragState.draggedId;
            const isDroppedAndSnapping = tab.id === justDroppedTabId;
            const dragOffset = isDraggingThisTab
              ? dragState.currentX - dragState.startX
              : 0;

            let transform = "";

            if (!isInDropAnimation) {
              if (isDraggingThisTab) {
                transform = `translateX(${dragOffset}px)`;
              } else if (
                dragState.draggedIndex !== null &&
                dragState.targetIndex !== null
              ) {
                const draggedOriginalIndex = dragState.draggedIndex;
                const currentTargetIndex = dragState.targetIndex;

                if (
                  draggedOriginalIndex < currentTargetIndex &&
                  index > draggedOriginalIndex &&
                  index <= currentTargetIndex
                ) {
                  const draggedTabWidth =
                    tabRefs.current
                      .get(draggedOriginalIndex)
                      ?.getBoundingClientRect().width || 0;
                  const gap = 4;
                  transform = `translateX(-${draggedTabWidth + gap}px)`;
                } else if (
                  draggedOriginalIndex > currentTargetIndex &&
                  index >= currentTargetIndex &&
                  index < draggedOriginalIndex
                ) {
                  const draggedTabWidth =
                    tabRefs.current
                      .get(draggedOriginalIndex)
                      ?.getBoundingClientRect().width || 0;
                  const gap = 4;
                  transform = `translateX(${draggedTabWidth + gap}px)`;
                }
              }
            }

            return (
              <div
                key={tab.id}
                ref={(el) => {
                  if (el) {
                    tabRefs.current.set(index, el);
                  } else {
                    tabRefs.current.delete(index);
                  }
                }}
                draggable={true}
                onDragStart={(e) => {
                  e.stopPropagation();
                  handleDragStart(e, index);
                }}
                onDrag={handleDrag}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                e
                onMouseDown={(e) => {
                  if (e.button === 1 && !disableClose) {
                    e.preventDefault();
                    handleTabClose(tab.id);
                  }
                }}
                style={{
                  transform,
                  transition:
                    isDraggingThisTab ||
                    isDroppedAndSnapping ||
                    isInDropAnimation
                      ? "none"
                      : "transform 200ms ease-out",
                  zIndex: isDraggingThisTab ? 1000 : 1,
                  position: "relative",
                  cursor: isDraggingThisTab ? "grabbing" : "grab",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  flex: tab.type === "home" ? "0 0 auto" : "1 1 150px",
                  minWidth: tab.type === "home" ? "auto" : "150px",
                  maxWidth: tab.type === "home" ? "auto" : "450px",
                  display: "flex",
                }}
              >
                <Tab
                  tabType={tab.type}
                  title={tab.title}
                  isActive={isActive}
                  isSplit={isSplit}
                  onActivate={() => handleTabActivate(tab.id)}
                  onClose={
                    isTerminal ||
                    isServer ||
                    isFileManager ||
                    isTunnel ||
                    isDocker ||
                    isSshManager ||
                    isAdmin ||
                    isUserProfile
                      ? () => handleTabClose(tab.id)
                      : undefined
                  }
                  onSplit={
                    isSplittable ? () => handleTabSplit(tab.id) : undefined
                  }
                  canSplit={isSplittable}
                  canClose={
                    isTerminal ||
                    isServer ||
                    isFileManager ||
                    isTunnel ||
                    isDocker ||
                    isSshManager ||
                    isAdmin ||
                    isUserProfile
                  }
                  disableActivate={disableActivate}
                  disableSplit={disableSplit}
                  disableClose={disableClose}
                  isDragging={isDraggingThisTab}
                  isDragOver={false}
                />
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-center gap-2 flex-1 px-2">
          <TabDropdown />

          <Button
            variant="outline"
            onClick={() => setToolsSidebarOpen(!toolsSidebarOpen)}
            className="w-[30px] h-[30px] border-dark-border"
            title={t("nav.tools")}
          >
            <Hammer className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            onClick={() => setIsTopbarOpen(false)}
            className="w-[30px] h-[30px]"
          >
            <ChevronUpIcon />
          </Button>
        </div>
      </div>

      {!isTopbarOpen && (
        <div
          onClick={() => setIsTopbarOpen(true)}
          className="fixed top-0 cursor-pointer flex items-center justify-center rounded-bl-md rounded-br-md"
          style={{
            left: leftPosition,
            right: rightPosition,
            height: "10px",
            zIndex: 9999,
            backgroundColor: "#18181b",
            border: "2px solid #27272a",
            borderTop: "none",
          }}
        >
          <ChevronDown size={10} />
        </div>
      )}

      <SSHToolsSidebar
        isOpen={toolsSidebarOpen}
        onClose={() => setToolsSidebarOpen(false)}
        onSnippetExecute={handleSnippetExecute}
        sidebarWidth={rightSidebarWidth}
        setSidebarWidth={setRightSidebarWidth}
        initialTab={
          commandHistoryTabActive
            ? "command-history"
            : splitScreenTabActive
              ? "split-screen"
              : undefined
        }
        onTabChange={() => {
          setCommandHistoryTabActive(false);
          setSplitScreenTabActive(false);
        }}
      />
    </div>
  );
}
