import React, { useState } from "react";
import { flushSync } from "react-dom";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ChevronDown, ChevronUpIcon } from "lucide-react";
import { Tab } from "@/ui/Desktop/Navigation/Tabs/Tab.tsx";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import { useTranslation } from "react-i18next";
import { TabDropdown } from "@/ui/Desktop/Navigation/Tabs/TabDropdown.tsx";
import { SnippetsSidebar } from "@/ui/Desktop/Apps/Terminal/SnippetsSidebar.tsx";
import { SshToolsSidebar } from "@/ui/Desktop/Apps/Tools/SshToolsSidebar.tsx";
import { ToolsMenu } from "@/ui/Desktop/Apps/Tools/ToolsMenu.tsx";

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
}

export function TopNavbar({
  isTopbarOpen,
  setIsTopbarOpen,
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
  const leftPosition = state === "collapsed" ? "26px" : "264px";
  const { t } = useTranslation();

  const [toolsSheetOpen, setToolsSheetOpen] = useState(false);
  const [snippetsSidebarOpen, setSnippetsSidebarOpen] = useState(false);
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
    setSplitScreenTab(tabId);
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
      const timer = setTimeout(() => setJustDroppedTabId(null), 50); // Clear after a short delay
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

    // Build array of tab boundaries in ORIGINAL order
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
      accumulatedX += tabWidth + 4; // 4px gap
    });

    if (tabBoundaries.length === 0) return null;

    // Calculate the dragged tab's center in container coordinates
    const containerRect = containerRef.current.getBoundingClientRect();
    const draggedTab = tabBoundaries[draggedIndex];
    // Convert absolute positions to container-relative coordinates
    const currentX = dragState.currentX - containerRect.left;
    const startX = dragState.startX - containerRect.left;
    const offset = currentX - startX;
    const draggedCenter = draggedTab.mid + offset;

    // Determine target index based on where the dragged tab's center is
    let newTargetIndex = draggedIndex;

    if (offset < 0) {
      // Moving left - find the leftmost tab whose midpoint we've passed
      for (let i = draggedIndex - 1; i >= 0; i--) {
        if (draggedCenter < tabBoundaries[i].mid) {
          newTargetIndex = i;
        } else {
          break;
        }
      }
    } else if (offset > 0) {
      // Moving right - find the rightmost tab whose midpoint we've passed
      for (let i = draggedIndex + 1; i < tabBoundaries.length; i++) {
        if (draggedCenter > tabBoundaries[i].mid) {
          newTargetIndex = i;
        } else {
          break;
        }
      }
      // Edge case: if dragged past the last tab, target should be at the very end
      const lastTabIndex = tabBoundaries.length - 1;
      if (lastTabIndex >= 0) {
        // Ensure there's at least one tab
        const lastTabEl = tabRefs.current.get(lastTabIndex);
        if (lastTabEl) {
          const lastTabRect = lastTabEl.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();
          const lastTabEndInContainer = lastTabRect.right - containerRect.left;
          if (currentX > lastTabEndInContainer) {
            // When dragging past the last tab, insert at the very end
            // Use the last valid index (length - 1) not length itself
            newTargetIndex = lastTabIndex;
          }
        }
      }
    }

    return newTargetIndex;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    // Firefox compatibility - track position via dragover
    if (dragState.draggedIndex === null) return;

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    // Update currentX if we have a valid clientX (Firefox may not provide it in onDrag)
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

      // Set animation flag and clear drag state synchronously
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
        className="fixed z-10 h-[50px] border-2 border-dark-border rounded-lg transition-all duration-200 ease-linear flex flex-row transform-none m-0 p-0"
        style={{
          top: isTopbarOpen ? "0.5rem" : "-3rem",
          left: leftPosition,
          right: "17px",
          backgroundColor: "#1e1e21",
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
            const isSshManager = tab.type === "ssh_manager";
            const isAdmin = tab.type === "admin";
            const isUserProfile = tab.type === "user_profile";
            const isSplittable = isTerminal || isServer || isFileManager;
            const isSplitButtonDisabled =
              (isActive && !isSplitScreenActive) ||
              ((allSplitScreenTab?.length || 0) >= 3 && !isSplit);
            const disableSplit =
              !isSplittable ||
              isSplitButtonDisabled ||
              isActive ||
              currentTabIsHome ||
              currentTabIsSshManager ||
              currentTabIsAdmin ||
              currentTabIsUserProfile;
            const disableActivate =
              isSplit ||
              ((tab.type === "home" ||
                tab.type === "ssh_manager" ||
                tab.type === "admin" ||
                tab.type === "user_profile") &&
                isSplitScreenActive);
            const isHome = tab.type === "home";
            const disableClose =
              (isSplitScreenActive && isActive) || isSplit || isHome;

            const isDraggingThisTab = dragState.draggedIndex === index;
            const isTheDraggedTab = tab.id === dragState.draggedId;
            const isDroppedAndSnapping = tab.id === justDroppedTabId; // New condition
            const dragOffset = isDraggingThisTab
              ? dragState.currentX - dragState.startX
              : 0;

            let transform = "";

            // Skip all transforms if we just dropped to prevent glitches
            if (!isInDropAnimation) {
              if (isDraggingThisTab) {
                transform = `translateX(${dragOffset}px)`;
              } else if (
                dragState.draggedIndex !== null &&
                dragState.targetIndex !== null
              ) {
                const draggedOriginalIndex = dragState.draggedIndex;
                const currentTargetIndex = dragState.targetIndex;

                // Determine if this tab should shift left or right
                if (
                  draggedOriginalIndex < currentTargetIndex && // Dragging rightwards
                  index > draggedOriginalIndex && // This tab is to the right of the original position
                  index <= currentTargetIndex // This tab is at or before the target position
                ) {
                  // Shift left to make space
                  const draggedTabWidth =
                    tabRefs.current
                      .get(draggedOriginalIndex)
                      ?.getBoundingClientRect().width || 0;
                  const gap = 4;
                  transform = `translateX(-${draggedTabWidth + gap}px)`;
                } else if (
                  draggedOriginalIndex > currentTargetIndex && // Dragging leftwards
                  index >= currentTargetIndex && // This tab is at or after the target position
                  index < draggedOriginalIndex // This tab is to the left of the original position
                ) {
                  // Shift right to make space
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
                  // Middle mouse button (button === 1)
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

          <ToolsMenu
            onOpenSshTools={() => setToolsSheetOpen(true)}
            onOpenSnippets={() => setSnippetsSidebarOpen(true)}
          />

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
          className="absolute top-0 left-0 w-full h-[10px] cursor-pointer z-20 flex items-center justify-center rounded-bl-md rounded-br-md"
          style={{ backgroundColor: "#1e1e21" }}
        >
          <ChevronDown size={10} />
        </div>
      )}

      <SshToolsSidebar
        isOpen={toolsSheetOpen}
        onClose={() => setToolsSheetOpen(false)}
      />

      <SnippetsSidebar
        isOpen={snippetsSidebarOpen}
        onClose={() => setSnippetsSidebarOpen(false)}
        onExecute={handleSnippetExecute}
      />
    </div>
  );
}
