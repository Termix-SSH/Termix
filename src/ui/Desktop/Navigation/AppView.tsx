import React, { useEffect, useRef, useState, useMemo } from "react";
import { Terminal } from "@/ui/Desktop/Apps/Terminal/Terminal.tsx";
import { Server as ServerView } from "@/ui/Desktop/Apps/Server/Server.tsx";
import { FileManager } from "@/ui/Desktop/Apps/File Manager/FileManager.tsx";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable.tsx";
import * as ResizablePrimitive from "react-resizable-panels";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

interface TabData {
  id: number;
  type: string;
  title: string;
  terminalRef?: {
    current?: {
      fit?: () => void;
      notifyResize?: () => void;
      refresh?: () => void;
    };
  };
  hostConfig?: unknown;
  [key: string]: unknown;
}

interface TerminalViewProps {
  isTopbarOpen?: boolean;
}

export function AppView({
  isTopbarOpen = true,
}: TerminalViewProps): React.ReactElement {
  const { tabs, currentTab, allSplitScreenTab, removeTab } = useTabs() as {
    tabs: TabData[];
    currentTab: number;
    allSplitScreenTab: number[];
    removeTab: (id: number) => void;
  };
  const { state: sidebarState } = useSidebar();

  const terminalTabs = useMemo(
    () =>
      tabs.filter(
        (tab: TabData) =>
          tab.type === "terminal" ||
          tab.type === "server" ||
          tab.type === "file_manager",
      ),
    [tabs],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [panelRects, setPanelRects] = useState<Record<string, DOMRect | null>>(
    {},
  );
  const [ready, setReady] = useState<boolean>(true);
  const [resetKey, setResetKey] = useState<number>(0);

  const updatePanelRects = () => {
    const next: Record<string, DOMRect | null> = {};
    Object.entries(panelRefs.current).forEach(([id, el]) => {
      if (el) next[id] = el.getBoundingClientRect();
    });
    setPanelRects(next);
  };

  const fitActiveAndNotify = () => {
    const visibleIds: number[] = [];
    if (allSplitScreenTab.length === 0) {
      if (currentTab) visibleIds.push(currentTab);
    } else {
      const splitIds = allSplitScreenTab as number[];
      visibleIds.push(currentTab, ...splitIds.filter((i) => i !== currentTab));
    }
    terminalTabs.forEach((t: TabData) => {
      if (visibleIds.includes(t.id)) {
        const ref = t.terminalRef?.current;
        if (ref?.fit) ref.fit();
        if (ref?.notifyResize) ref.notifyResize();
        if (ref?.refresh) ref.refresh();
      }
    });
  };

  const layoutScheduleRef = useRef<number | null>(null);
  const scheduleMeasureAndFit = () => {
    if (layoutScheduleRef.current)
      cancelAnimationFrame(layoutScheduleRef.current);
    layoutScheduleRef.current = requestAnimationFrame(() => {
      updatePanelRects();
      layoutScheduleRef.current = requestAnimationFrame(() => {
        fitActiveAndNotify();
      });
    });
  };

  const hideThenFit = () => {
    setReady(false);
    requestAnimationFrame(() => {
      updatePanelRects();
      requestAnimationFrame(() => {
        fitActiveAndNotify();
        setReady(true);
      });
    });
  };

  const prevStateRef = useRef({
    terminalTabsLength: terminalTabs.length,
    currentTab,
    splitScreenTabsStr: allSplitScreenTab.join(","),
    terminalTabIds: terminalTabs.map((t) => t.id).join(","),
  });

  useEffect(() => {
    const prev = prevStateRef.current;
    const currentTabIds = terminalTabs.map((t) => t.id).join(",");

    const lengthChanged = prev.terminalTabsLength !== terminalTabs.length;
    const currentTabChanged = prev.currentTab !== currentTab;
    const splitChanged =
      prev.splitScreenTabsStr !== allSplitScreenTab.join(",");
    const tabIdsChanged = prev.terminalTabIds !== currentTabIds;

    // Only trigger hideThenFit if tabs were added/removed (not just reordered)
    // or if current tab or split screen changed
    const isJustReorder =
      !lengthChanged && tabIdsChanged && !currentTabChanged && !splitChanged;

    console.log("AppView useEffect:", {
      lengthChanged,
      currentTabChanged,
      splitChanged,
      tabIdsChanged,
      isJustReorder,
      willCallHideThenFit:
        (lengthChanged || currentTabChanged || splitChanged) && !isJustReorder,
    });

    if (
      (lengthChanged || currentTabChanged || splitChanged) &&
      !isJustReorder
    ) {
      console.log(
        "CALLING hideThenFit - this will set ready=false and cause Terminal isVisible to become false!",
      );
      hideThenFit();
    }

    // Update the ref for next comparison
    prevStateRef.current = {
      terminalTabsLength: terminalTabs.length,
      currentTab,
      splitScreenTabsStr: allSplitScreenTab.join(","),
      terminalTabIds: currentTabIds,
    };
  }, [
    currentTab,
    terminalTabs.length,
    allSplitScreenTab.join(","),
    terminalTabs,
  ]);

  useEffect(() => {
    scheduleMeasureAndFit();
  }, [allSplitScreenTab.length, isTopbarOpen, sidebarState, resetKey]);

  useEffect(() => {
    const roContainer = containerRef.current
      ? new ResizeObserver(() => {
          updatePanelRects();
          fitActiveAndNotify();
        })
      : null;
    if (containerRef.current && roContainer)
      roContainer.observe(containerRef.current);
    return () => roContainer?.disconnect();
  }, []);

  useEffect(() => {
    const onWinResize = () => {
      updatePanelRects();
      fitActiveAndNotify();
    };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, []);

  const HEADER_H = 28;

  // Create a stable map of terminal IDs to preserve component identity
  const terminalIdMapRef = useRef<Set<number>>(new Set());

  // Track all terminal IDs that have ever existed
  useEffect(() => {
    terminalTabs.forEach((t) => terminalIdMapRef.current.add(t.id));
  }, [terminalTabs]);

  const renderTerminalsLayer = () => {
    const styles: Record<number, React.CSSProperties> = {};
    const splitTabs = terminalTabs.filter((tab: TabData) =>
      allSplitScreenTab.includes(tab.id),
    );
    const mainTab = terminalTabs.find((tab: TabData) => tab.id === currentTab);
    const layoutTabs = [
      mainTab,
      ...splitTabs.filter(
        (t: TabData) => t && t.id !== (mainTab && (mainTab as TabData).id),
      ),
    ].filter((t): t is TabData => t !== null && t !== undefined);

    if (allSplitScreenTab.length === 0 && mainTab) {
      const isFileManagerTab = mainTab.type === "file_manager";
      styles[mainTab.id] = {
        position: "absolute",
        top: isFileManagerTab ? 0 : 4,
        left: isFileManagerTab ? 0 : 4,
        right: isFileManagerTab ? 0 : 4,
        bottom: isFileManagerTab ? 0 : 4,
        zIndex: 20,
        display: "block",
        pointerEvents: "auto",
        opacity: ready ? 1 : 0,
      };
    } else {
      layoutTabs.forEach((t: TabData) => {
        const rect = panelRects[String(t.id)];
        const parentRect = containerRef.current?.getBoundingClientRect();
        if (rect && parentRect) {
          styles[t.id] = {
            position: "absolute",
            top: rect.top - parentRect.top + HEADER_H + 4,
            left: rect.left - parentRect.left + 4,
            width: rect.width - 8,
            height: rect.height - HEADER_H - 8,
            zIndex: 20,
            display: "block",
            pointerEvents: "auto",
            opacity: ready ? 1 : 0,
          };
        }
      });
    }

    // Render in a STABLE order by ID to prevent React from unmounting
    // Sort by ID instead of array position
    const sortedTerminalTabs = [...terminalTabs].sort((a, b) => a.id - b.id);

    return (
      <div className="absolute inset-0 z-[1]">
        {sortedTerminalTabs.map((t: TabData) => {
          const hasStyle = !!styles[t.id];
          const isVisible =
            hasStyle || (allSplitScreenTab.length === 0 && t.id === currentTab);

          const finalStyle: React.CSSProperties = hasStyle
            ? { ...styles[t.id], overflow: "hidden" }
            : ({
                position: "absolute",
                inset: 0,
                visibility: "hidden",
                pointerEvents: "none",
                zIndex: 0,
              } as React.CSSProperties);

          const effectiveVisible = isVisible && ready;

          return (
            <div key={t.id} style={finalStyle}>
              <div className="absolute inset-0 rounded-md bg-dark-bg">
                {t.type === "terminal" ? (
                  <Terminal
                    ref={t.terminalRef}
                    hostConfig={t.hostConfig}
                    isVisible={effectiveVisible}
                    title={t.title}
                    showTitle={false}
                    splitScreen={allSplitScreenTab.length > 0}
                    onClose={() => removeTab(t.id)}
                  />
                ) : t.type === "server" ? (
                  <ServerView
                    hostConfig={t.hostConfig}
                    title={t.title}
                    isVisible={effectiveVisible}
                    isTopbarOpen={isTopbarOpen}
                    embedded
                  />
                ) : (
                  <FileManager
                    embedded
                    initialHost={t.hostConfig}
                    onClose={() => removeTab(t.id)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const ResetButton = ({ onClick }: { onClick: () => void }) => (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-label="Reset split sizes"
      className="absolute top-0 right-0 h-[28px] w-[28px] !rounded-none border-l-1 border-b-1 border-dark-border-panel bg-dark-bg-panel hover:bg-dark-bg-panel-hover text-white flex items-center justify-center p-0"
    >
      <RefreshCcw className="h-4 w-4" />
    </Button>
  );

  const handleReset = () => {
    setResetKey((k) => k + 1);
    requestAnimationFrame(() => scheduleMeasureAndFit());
  };

  const renderSplitOverlays = () => {
    const splitTabs = terminalTabs.filter((tab: TabData) =>
      allSplitScreenTab.includes(tab.id),
    );
    const mainTab = terminalTabs.find((tab: TabData) => tab.id === currentTab);
    const layoutTabs = [
      mainTab,
      ...splitTabs.filter(
        (t: TabData) => t && t.id !== (mainTab && (mainTab as TabData).id),
      ),
    ].filter((t): t is TabData => t !== null && t !== undefined);
    if (allSplitScreenTab.length === 0) return null;

    const handleStyle = {
      pointerEvents: "auto",
      zIndex: 12,
      background: "var(--color-dark-border)",
    } as React.CSSProperties;
    const commonGroupProps: {
      onLayout: () => void;
      onResize: () => void;
    } = {
      onLayout: scheduleMeasureAndFit,
      onResize: scheduleMeasureAndFit,
    };

    if (layoutTabs.length === 2) {
      const [a, b] = layoutTabs;
      return (
        <div className="absolute inset-0 z-[10] pointer-events-none">
          <ResizablePrimitive.PanelGroup
            key={resetKey}
            direction="horizontal"
            className="h-full w-full"
            {...commonGroupProps}
          >
            <ResizablePanel
              defaultSize={50}
              minSize={20}
              className="!overflow-hidden h-full w-full"
              id={`panel-${a.id}`}
              order={1}
            >
              <div
                ref={(el) => {
                  panelRefs.current[String(a.id)] = el;
                }}
                className="h-full w-full flex flex-col bg-transparent relative"
              >
                <div className="bg-dark-bg-panel text-white text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-dark-border-panel tracking-[1px] m-0 pointer-events-auto z-[11] relative">
                  {a.title}
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle style={handleStyle} />
            <ResizablePanel
              defaultSize={50}
              minSize={20}
              className="!overflow-hidden h-full w-full"
              id={`panel-${b.id}`}
              order={2}
            >
              <div
                ref={(el) => {
                  panelRefs.current[String(b.id)] = el;
                }}
                className="h-full w-full flex flex-col bg-transparent relative"
              >
                <div className="bg-dark-bg-panel text-white text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-dark-border-panel tracking-[1px] m-0 pointer-events-auto z-[11] relative">
                  {b.title}
                  <ResetButton onClick={handleReset} />
                </div>
              </div>
            </ResizablePanel>
          </ResizablePrimitive.PanelGroup>
        </div>
      );
    }
    if (layoutTabs.length === 3) {
      const [a, b, c] = layoutTabs;
      return (
        <div className="absolute inset-0 z-[10] pointer-events-none">
          <ResizablePrimitive.PanelGroup
            key={resetKey}
            direction="vertical"
            className="h-full w-full"
            id="main-vertical"
            {...commonGroupProps}
          >
            <ResizablePanel
              defaultSize={50}
              minSize={20}
              className="!overflow-hidden h-full w-full"
              id="top-panel"
              order={1}
            >
              <ResizablePanelGroup
                key={`top-${resetKey}`}
                direction="horizontal"
                className="h-full w-full"
                id="top-horizontal"
                {...commonGroupProps}
              >
                <ResizablePanel
                  defaultSize={50}
                  minSize={20}
                  className="!overflow-hidden h-full w-full"
                  id={`panel-${a.id}`}
                  order={1}
                >
                  <div
                    ref={(el) => {
                      panelRefs.current[String(a.id)] = el;
                    }}
                    className="h-full w-full flex flex-col relative"
                  >
                    <div className="bg-dark-bg-panel text-white text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-dark-border-panel tracking-[1px] m-0 pointer-events-auto z-[11] relative">
                      {a.title}
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle style={handleStyle} />
                <ResizablePanel
                  defaultSize={50}
                  minSize={20}
                  className="!overflow-hidden h-full w-full"
                  id={`panel-${b.id}`}
                  order={2}
                >
                  <div
                    ref={(el) => {
                      panelRefs.current[String(b.id)] = el;
                    }}
                    className="h-full w-full flex flex-col relative"
                  >
                    <div className="bg-dark-bg-panel text-white text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-dark-border-panel tracking-[1px] m-0 pointer-events-auto z-[11] relative">
                      {b.title}
                      <ResetButton onClick={handleReset} />
                    </div>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle style={handleStyle} />
            <ResizablePanel
              defaultSize={50}
              minSize={20}
              className="!overflow-hidden h-full w-full"
              id="bottom-panel"
              order={2}
            >
              <div
                ref={(el) => {
                  panelRefs.current[String(c.id)] = el;
                }}
                className="h-full w-full flex flex-col relative"
              >
                <div className="bg-dark-bg-panel text-white text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-dark-border-panel tracking-[1px] m-0 pointer-events-auto z-[11] relative">
                  {c.title}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePrimitive.PanelGroup>
        </div>
      );
    }
    if (layoutTabs.length === 4) {
      const [a, b, c, d] = layoutTabs;
      return (
        <div className="absolute inset-0 z-[10] pointer-events-none">
          <ResizablePrimitive.PanelGroup
            key={resetKey}
            direction="vertical"
            className="h-full w-full"
            id="main-vertical"
            {...commonGroupProps}
          >
            <ResizablePanel
              defaultSize={50}
              minSize={20}
              className="!overflow-hidden h-full w-full"
              id="top-panel"
              order={1}
            >
              <ResizablePanelGroup
                key={`top-${resetKey}`}
                direction="horizontal"
                className="h-full w-full"
                id="top-horizontal"
                {...commonGroupProps}
              >
                <ResizablePanel
                  defaultSize={50}
                  minSize={20}
                  className="!overflow-hidden h-full w-full"
                  id={`panel-${a.id}`}
                  order={1}
                >
                  <div
                    ref={(el) => {
                      panelRefs.current[String(a.id)] = el;
                    }}
                    className="h-full w-full flex flex-col relative"
                  >
                    <div className="bg-dark-bg-panel text-white text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-dark-border-panel tracking-[1px] m-0 pointer-events-auto z-[11] relative">
                      {a.title}
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle style={handleStyle} />
                <ResizablePanel
                  defaultSize={50}
                  minSize={20}
                  className="!overflow-hidden h-full w-full"
                  id={`panel-${b.id}`}
                  order={2}
                >
                  <div
                    ref={(el) => {
                      panelRefs.current[String(b.id)] = el;
                    }}
                    className="h-full w-full flex flex-col relative"
                  >
                    <div className="bg-dark-bg-panel text-white text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-dark-border-panel tracking-[1px] m-0 pointer-events-auto z-[11] relative">
                      {b.title}
                      <ResetButton onClick={handleReset} />
                    </div>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle style={handleStyle} />
            <ResizablePanel
              defaultSize={50}
              minSize={20}
              className="!overflow-hidden h-full w-full"
              id="bottom-panel"
              order={2}
            >
              <ResizablePanelGroup
                key={`bottom-${resetKey}`}
                direction="horizontal"
                className="h-full w-full"
                id="bottom-horizontal"
                {...commonGroupProps}
              >
                <ResizablePanel
                  defaultSize={50}
                  minSize={20}
                  className="!overflow-hidden h-full w-full"
                  id={`panel-${c.id}`}
                  order={1}
                >
                  <div
                    ref={(el) => {
                      panelRefs.current[String(c.id)] = el;
                    }}
                    className="h-full w-full flex flex-col relative"
                  >
                    <div className="bg-dark-bg-panel text-white text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-dark-border-panel tracking-[1px] m-0 pointer-events-auto z-[11] relative">
                      {c.title}
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle style={handleStyle} />
                <ResizablePanel
                  defaultSize={50}
                  minSize={20}
                  className="!overflow-hidden h-full w-full"
                  id={`panel-${d.id}`}
                  order={2}
                >
                  <div
                    ref={(el) => {
                      panelRefs.current[String(d.id)] = el;
                    }}
                    className="h-full w-full flex flex-col relative"
                  >
                    <div className="bg-dark-bg-panel text-white text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-dark-border-panel tracking-[1px] m-0 pointer-events-auto z-[11] relative">
                      {d.title}
                    </div>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePrimitive.PanelGroup>
        </div>
      );
    }
    return null;
  };

  const currentTabData = tabs.find((tab: TabData) => tab.id === currentTab);
  const isFileManager = currentTabData?.type === "file_manager";
  const isSplitScreen = allSplitScreenTab.length > 0;

  const topMarginPx = isTopbarOpen ? 74 : 26;
  const leftMarginPx = sidebarState === "collapsed" ? 26 : 8;
  const bottomMarginPx = 8;

  return (
    <div
      ref={containerRef}
      className="border-2 border-dark-border rounded-lg overflow-hidden overflow-x-hidden relative"
      style={{
        background:
          isFileManager && !isSplitScreen
            ? "var(--color-dark-bg-darkest)"
            : "var(--color-dark-bg)",
        marginLeft: leftMarginPx,
        marginRight: 17,
        marginTop: topMarginPx,
        marginBottom: bottomMarginPx,
        height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
      }}
    >
      {renderTerminalsLayer()}
      {renderSplitOverlays()}
    </div>
  );
}
