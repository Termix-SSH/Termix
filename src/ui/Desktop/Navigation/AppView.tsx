import React, {useEffect, useRef, useState} from "react";
import {Terminal} from "@/ui/Desktop/Apps/Terminal/Terminal.tsx";
import {Server as ServerView} from "@/ui/Desktop/Apps/Server/Server.tsx";
import {FileManager} from "@/ui/Desktop/Apps/File Manager/FileManager.tsx";
import {useTabs} from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import {ResizablePanelGroup, ResizablePanel, ResizableHandle} from '@/components/ui/resizable.tsx';
import * as ResizablePrimitive from "react-resizable-panels";
import {useSidebar} from "@/components/ui/sidebar.tsx";
import {LucideRefreshCcw, LucideRefreshCw, RefreshCcw, RefreshCcwDot} from "lucide-react";
import {Button} from "@/components/ui/button.tsx";

interface TerminalViewProps {
    isTopbarOpen?: boolean;
}

export function AppView({isTopbarOpen = true}: TerminalViewProps): React.ReactElement {
    const {tabs, currentTab, allSplitScreenTab} = useTabs() as any;
    const {state: sidebarState} = useSidebar();

    const terminalTabs = tabs.filter((tab: any) => tab.type === 'terminal' || tab.type === 'server' || tab.type === 'file_manager');

    const containerRef = useRef<HTMLDivElement | null>(null);
    const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [panelRects, setPanelRects] = useState<Record<string, DOMRect | null>>({});
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
        terminalTabs.forEach((t: any) => {
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
        if (layoutScheduleRef.current) cancelAnimationFrame(layoutScheduleRef.current);
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

    useEffect(() => {
        hideThenFit();
    }, [currentTab, terminalTabs.length, allSplitScreenTab.join(',')]);

    useEffect(() => {
        scheduleMeasureAndFit();
    }, [allSplitScreenTab.length, isTopbarOpen, sidebarState, resetKey]);

    useEffect(() => {
        const roContainer = containerRef.current ? new ResizeObserver(() => {
            updatePanelRects();
            fitActiveAndNotify();
        }) : null;
        if (containerRef.current && roContainer) roContainer.observe(containerRef.current);
        return () => roContainer?.disconnect();
    }, []);

    useEffect(() => {
        const onWinResize = () => {
            updatePanelRects();
            fitActiveAndNotify();
        };
        window.addEventListener('resize', onWinResize);
        return () => window.removeEventListener('resize', onWinResize);
    }, []);

    const HEADER_H = 28;

    const renderTerminalsLayer = () => {
        const styles: Record<number, React.CSSProperties> = {};
        const splitTabs = terminalTabs.filter((tab: any) => allSplitScreenTab.includes(tab.id));
        const mainTab = terminalTabs.find((tab: any) => tab.id === currentTab);
        const layoutTabs = [mainTab, ...splitTabs.filter((t: any) => t && t.id !== (mainTab && (mainTab as any).id))].filter(Boolean) as any[];

        if (allSplitScreenTab.length === 0 && mainTab) {
            const isFileManagerTab = mainTab.type === 'file_manager';
            styles[mainTab.id] = {
                position: 'absolute',
                top: isFileManagerTab ? 0 : 2,
                left: isFileManagerTab ? 0 : 2,
                right: isFileManagerTab ? 0 : 2,
                bottom: isFileManagerTab ? 0 : 2,
                zIndex: 20,
                display: 'block',
                pointerEvents: 'auto',
                opacity: ready ? 1 : 0
            };
        } else {
            layoutTabs.forEach((t: any) => {
                const rect = panelRects[String(t.id)];
                const parentRect = containerRef.current?.getBoundingClientRect();
                if (rect && parentRect) {
                    styles[t.id] = {
                        position: 'absolute',
                        top: (rect.top - parentRect.top) + HEADER_H + 2,
                        left: (rect.left - parentRect.left) + 2,
                        width: rect.width - 4,
                        height: rect.height - HEADER_H - 4,
                        zIndex: 20,
                        display: 'block',
                        pointerEvents: 'auto',
                        opacity: ready ? 1 : 0,
                    };
                }
            });
        }

        return (
            <div style={{position: 'absolute', inset: 0, zIndex: 1}}>
                {terminalTabs.map((t: any) => {
                    const hasStyle = !!styles[t.id];
                    const isVisible = hasStyle || (allSplitScreenTab.length === 0 && t.id === currentTab);

                    const finalStyle: React.CSSProperties = hasStyle
                        ? {...styles[t.id], overflow: 'hidden'}
                        : {
                            position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none', zIndex: 0,
                        } as React.CSSProperties;

                    const effectiveVisible = isVisible && ready;
                    return (
                        <div key={t.id} style={finalStyle}>
                            <div className="absolute inset-0 rounded-md bg-[#18181b]">
                                {t.type === 'terminal' ? (
                                    <Terminal
                                        ref={t.terminalRef}
                                        hostConfig={t.hostConfig}
                                        isVisible={effectiveVisible}
                                        title={t.title}
                                        showTitle={false}
                                        splitScreen={allSplitScreenTab.length > 0}
                                    />
                                ) : t.type === 'server' ? (
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
                                    />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const ResetButton = ({onClick}: { onClick: () => void }) => (
        <Button
            type="button"
            variant="ghost"
            onClick={onClick}
            aria-label="Reset split sizes"
            className="absolute top-0 right-0 h-[28px] w-[28px] !rounded-none border-l-1 border-b-1 border-[#222224] bg-[#1b1b1e] hover:bg-[#232327] text-white flex items-center justify-center p-0"
        >
            <RefreshCcw className="h-4 w-4"/>
        </Button>
    );

    const handleReset = () => {
        setResetKey((k) => k + 1);
        requestAnimationFrame(() => scheduleMeasureAndFit());
    };

    const renderSplitOverlays = () => {
        const splitTabs = terminalTabs.filter((tab: any) => allSplitScreenTab.includes(tab.id));
        const mainTab = terminalTabs.find((tab: any) => tab.id === currentTab);
        const layoutTabs = [mainTab, ...splitTabs.filter((t: any) => t && t.id !== (mainTab && (mainTab as any).id))].filter(Boolean) as any[];
        if (allSplitScreenTab.length === 0) return null;

        const handleStyle = {pointerEvents: 'auto', zIndex: 12, background: '#303032'} as React.CSSProperties;
        const commonGroupProps = {onLayout: scheduleMeasureAndFit, onResize: scheduleMeasureAndFit} as any;

        if (layoutTabs.length === 2) {
            const [a, b] = layoutTabs as any[];
            return (
                <div style={{position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none'}}>
                    <ResizablePrimitive.PanelGroup key={resetKey} direction="horizontal"
                                                   className="h-full w-full" {...commonGroupProps}>
                        <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h-full w-full"
                                        id={`panel-${a.id}`} order={1}>
                            <div ref={el => {
                                panelRefs.current[String(a.id)] = el;
                            }} style={{
                                height: '100%',
                                width: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                background: 'transparent',
                                position: 'relative'
                            }}>
                                <div style={{
                                    background: '#1b1b1e',
                                    color: '#fff',
                                    fontSize: 13,
                                    height: HEADER_H,
                                    lineHeight: `${HEADER_H}px`,
                                    padding: '0 10px',
                                    borderBottom: '1px solid #222224',
                                    letterSpacing: 1,
                                    margin: 0,
                                    pointerEvents: 'auto',
                                    zIndex: 11,
                                    position: 'relative'
                                }}>{a.title}</div>
                            </div>
                        </ResizablePanel>
                        <ResizableHandle style={handleStyle}/>
                        <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h-full w-full"
                                        id={`panel-${b.id}`} order={2}>
                            <div ref={el => {
                                panelRefs.current[String(b.id)] = el;
                            }} style={{
                                height: '100%',
                                width: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                background: 'transparent',
                                position: 'relative'
                            }}>
                                <div style={{
                                    background: '#1b1b1e',
                                    color: '#fff',
                                    fontSize: 13,
                                    height: HEADER_H,
                                    lineHeight: `${HEADER_H}px`,
                                    padding: '0 10px',
                                    borderBottom: '1px solid #222224',
                                    letterSpacing: 1,
                                    margin: 0,
                                    pointerEvents: 'auto',
                                    zIndex: 11,
                                    position: 'relative'
                                }}>
                                    {b.title}
                                    <ResetButton onClick={handleReset}/>
                                </div>
                            </div>
                        </ResizablePanel>
                    </ResizablePrimitive.PanelGroup>
                </div>
            );
        }
        if (layoutTabs.length === 3) {
            const [a, b, c] = layoutTabs as any[];
            return (
                <div style={{position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none'}}>
                    <ResizablePrimitive.PanelGroup key={resetKey} direction="vertical" className="h-full w-full"
                                                   id="main-vertical" {...commonGroupProps}>
                        <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h-full w-full"
                                        id="top-panel" order={1}>
                            <ResizablePanelGroup key={`top-${resetKey}`} direction="horizontal"
                                                 className="h-full w-full" id="top-horizontal" {...commonGroupProps}>
                                <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h-full w-full"
                                                id={`panel-${a.id}`} order={1}>
                                    <div ref={el => {
                                        panelRefs.current[String(a.id)] = el;
                                    }} style={{
                                        height: '100%',
                                        width: '100%',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        position: 'relative'
                                    }}>
                                        <div style={{
                                            background: '#1b1b1e',
                                            color: '#fff',
                                            fontSize: 13,
                                            height: HEADER_H,
                                            lineHeight: `${HEADER_H}px`,
                                            padding: '0 10px',
                                            borderBottom: '1px solid #222224',
                                            letterSpacing: 1,
                                            margin: 0,
                                            pointerEvents: 'auto',
                                            zIndex: 11,
                                            position: 'relative'
                                        }}>{a.title}</div>
                                    </div>
                                </ResizablePanel>
                                <ResizableHandle style={handleStyle}/>
                                <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h-full w-full"
                                                id={`panel-${b.id}`} order={2}>
                                    <div ref={el => {
                                        panelRefs.current[String(b.id)] = el;
                                    }} style={{
                                        height: '100%',
                                        width: '100%',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        position: 'relative'
                                    }}>
                                        <div style={{
                                            background: '#1b1b1e',
                                            color: '#fff',
                                            fontSize: 13,
                                            height: HEADER_H,
                                            lineHeight: `${HEADER_H}px`,
                                            padding: '0 10px',
                                            borderBottom: '1px solid #222224',
                                            letterSpacing: 1,
                                            margin: 0,
                                            pointerEvents: 'auto',
                                            zIndex: 11,
                                            position: 'relative'
                                        }}>
                                            {b.title}
                                            <ResetButton onClick={handleReset}/>
                                        </div>
                                    </div>
                                </ResizablePanel>
                            </ResizablePanelGroup>
                        </ResizablePanel>
                        <ResizableHandle style={handleStyle}/>
                        <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h-full w-full"
                                        id="bottom-panel" order={2}>
                            <div ref={el => {
                                panelRefs.current[String(c.id)] = el;
                            }} style={{
                                height: '100%',
                                width: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                position: 'relative'
                            }}>
                                <div style={{
                                    background: '#1b1b1e',
                                    color: '#fff',
                                    fontSize: 13,
                                    height: HEADER_H,
                                    lineHeight: `${HEADER_H}px`,
                                    padding: '0 10px',
                                    borderBottom: '1px solid #222224',
                                    letterSpacing: 1,
                                    margin: 0,
                                    pointerEvents: 'auto',
                                    zIndex: 11,
                                    position: 'relative'
                                }}>{c.title}</div>
                            </div>
                        </ResizablePanel>
                    </ResizablePrimitive.PanelGroup>
                </div>
            );
        }
        if (layoutTabs.length === 4) {
            const [a, b, c, d] = layoutTabs as any[];
            return (
                <div style={{position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none'}}>
                    <ResizablePrimitive.PanelGroup key={resetKey} direction="vertical" className="h-full w-full"
                                                   id="main-vertical" {...commonGroupProps}>
                        <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h-full w-full"
                                        id="top-panel" order={1}>
                            <ResizablePanelGroup key={`top-${resetKey}`} direction="horizontal"
                                                 className="h-full w-full" id="top-horizontal" {...commonGroupProps}>
                                <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h_full w_full"
                                                id={`panel-${a.id}`} order={1}>
                                    <div ref={el => {
                                        panelRefs.current[String(a.id)] = el;
                                    }} style={{
                                        height: '100%',
                                        width: '100%',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        position: 'relative'
                                    }}>
                                        <div style={{
                                            background: '#1b1b1e',
                                            color: '#fff',
                                            fontSize: 13,
                                            height: HEADER_H,
                                            lineHeight: `${HEADER_H}px`,
                                            padding: '0 10px',
                                            borderBottom: '1px solid #222224',
                                            letterSpacing: 1,
                                            margin: 0,
                                            pointerEvents: 'auto',
                                            zIndex: 11,
                                            position: 'relative'
                                        }}>{a.title}</div>
                                    </div>
                                </ResizablePanel>
                                <ResizableHandle style={handleStyle}/>
                                <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h_full w_full"
                                                id={`panel-${b.id}`} order={2}>
                                    <div ref={el => {
                                        panelRefs.current[String(b.id)] = el;
                                    }} style={{
                                        height: '100%',
                                        width: '100%',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        position: 'relative'
                                    }}>
                                        <div style={{
                                            background: '#1b1b1e',
                                            color: '#fff',
                                            fontSize: 13,
                                            height: HEADER_H,
                                            lineHeight: `${HEADER_H}px`,
                                            padding: '0 10px',
                                            borderBottom: '1px solid #222224',
                                            letterSpacing: 1,
                                            margin: 0,
                                            pointerEvents: 'auto',
                                            zIndex: 11,
                                            position: 'relative'
                                        }}>
                                            {b.title}
                                            <ResetButton onClick={handleReset}/>
                                        </div>
                                    </div>
                                </ResizablePanel>
                            </ResizablePanelGroup>
                        </ResizablePanel>
                        <ResizableHandle style={handleStyle}/>
                        <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h_full w_full"
                                        id="bottom-panel" order={2}>
                            <ResizablePanelGroup key={`bottom-${resetKey}`} direction="horizontal"
                                                 className="h-full w-full" id="bottom-horizontal" {...commonGroupProps}>
                                <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h_full w_full"
                                                id={`panel-${c.id}`} order={1}>
                                    <div ref={el => {
                                        panelRefs.current[String(c.id)] = el;
                                    }} style={{
                                        height: '100%',
                                        width: '100%',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        position: 'relative'
                                    }}>
                                        <div style={{
                                            background: '#1b1b1e',
                                            color: '#fff',
                                            fontSize: 13,
                                            height: HEADER_H,
                                            lineHeight: `${HEADER_H}px`,
                                            padding: '0 10px',
                                            borderBottom: '1px solid #222224',
                                            letterSpacing: 1,
                                            margin: 0,
                                            pointerEvents: 'auto',
                                            zIndex: 11,
                                            position: 'relative'
                                        }}>{c.title}</div>
                                    </div>
                                </ResizablePanel>
                                <ResizableHandle style={handleStyle}/>
                                <ResizablePanel defaultSize={50} minSize={20} className="!overflow-hidden h_full w_full"
                                                id={`panel-${d.id}`} order={2}>
                                    <div ref={el => {
                                        panelRefs.current[String(d.id)] = el;
                                    }} style={{
                                        height: '100%',
                                        width: '100%',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        position: 'relative'
                                    }}>
                                        <div style={{
                                            background: '#1b1b1e',
                                            color: '#fff',
                                            fontSize: 13,
                                            height: HEADER_H,
                                            lineHeight: `${HEADER_H}px`,
                                            padding: '0 10px',
                                            borderBottom: '1px solid #222224',
                                            letterSpacing: 1,
                                            margin: 0,
                                            pointerEvents: 'auto',
                                            zIndex: 11,
                                            position: 'relative'
                                        }}>{d.title}</div>
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

    const currentTabData = tabs.find((tab: any) => tab.id === currentTab);
    const isFileManager = currentTabData?.type === 'file_manager';
    const isSplitScreen = allSplitScreenTab.length > 0;
    
    const topMarginPx = isTopbarOpen ? 74 : 26;
    const leftMarginPx = sidebarState === 'collapsed' ? 26 : 8;
    const bottomMarginPx = 8;

    return (
        <div
            ref={containerRef}
            className="border-2 border-[#303032] rounded-lg overflow-hidden overflow-x-hidden"
            style={{
                position: 'relative',
                background: (isFileManager && !isSplitScreen) ? '#09090b' : '#18181b',
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
