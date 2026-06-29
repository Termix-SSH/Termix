import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid } from "lucide-react";
import type {
  CanvasWidget,
  ContextMenuState,
  WidgetTypeId,
} from "@/types/homepage-types";
import { GRID_SIZE, MIN_ZOOM, MAX_ZOOM } from "@/types/homepage-types";
import {
  getHomepageItems,
  getHomepageLayout,
  createHomepageItem,
  updateHomepageItem,
  deleteHomepageItem,
  saveHomepageLayout,
} from "@/api/homepage-api";
import { snapToGrid } from "./canvas/snapToGrid";
import { screenToCanvas } from "./canvas/canvasGeometry";
import { useCanvasInput } from "./canvas/useCanvasInput";
import { useBoxDrag } from "./canvas/useBoxDrag";
import { useBoxResize } from "./canvas/useBoxResize";
import { CanvasDotBackground } from "./canvas/CanvasDotBackground";
import { WidgetShell } from "./widgets/WidgetShell";
import { AddWidgetMenu } from "./dialogs/AddWidgetMenu";
import { WidgetEditDialog } from "./dialogs/WidgetEditDialog";
import { HomepageToolbar } from "./toolbar/HomepageToolbar";
import { getWidgetType } from "./widgets/WidgetRegistry";

// Side-effect imports so widgets register themselves
import "./widgets/ServiceLinkWidget";
import "./widgets/ClockWidget";
import "./widgets/NotesWidget";
import "./widgets/BookmarkListWidget";
import "./widgets/HostStatusWidget";
import "./widgets/FolderWidget";
import "./widgets/WeatherWidget";
import "./widgets/IframeWidget";
import "./widgets/RssFeedWidget";
import "./widgets/MetricsChartWidget";
import "./widgets/HostGridWidget";
import "./widgets/AlertFeedWidget";
import "./widgets/PingStatusWidget";
import "./widgets/RecentActivityWidget";
import "./widgets/TermixUptimeWidget";
import "./widgets/SystemOverviewWidget";
import "./widgets/SshTerminalWidget";
import "./widgets/QuickConnectWidget";
import "./widgets/FileManagerWidget";
import "./widgets/DockerWidget";
import "./widgets/TunnelWidget";
import "./widgets/CalendarWidget";
import "./widgets/CountdownWidget";
import "./widgets/SearchBarWidget";
import "./widgets/TextBannerWidget";
import "./widgets/ImageWidget";
import "./widgets/MarkdownNotesWidget";
import "./widgets/CustomApiWidget";
import "./widgets/ServiceGridWidget";
import "./widgets/DashboardLinksWidget";
import "./widgets/SearchLinksWidget";
import "./widgets/LinkTreeWidget";

const CANVAS_SIZE = 100_000;
const DEFAULT_PAN = { x: CANVAS_SIZE / 2 - 600, y: CANVAS_SIZE / 2 - 400 };
const DEFAULT_ZOOM = 1.0;

interface HomepageCanvasProps {
  isReadOnly?: boolean;
  fitOnLoad?: boolean;
  onOpenFullscreen?: () => void;
}

function nextZOrder(widgets: CanvasWidget[]): number {
  const nonFolders = widgets.filter((w) => w.typeId !== "folder");
  return nonFolders.length === 0
    ? 1
    : Math.max(...nonFolders.map((w) => w.zOrder)) + 1;
}

export function HomepageCanvas({
  isReadOnly,
  fitOnLoad,
  onOpenFullscreen,
}: HomepageCanvasProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [widgets, setWidgets] = useState<CanvasWidget[]>([]);
  const [pan, setPan] = useState(DEFAULT_PAN);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [isLocked, setIsLocked] = useState(
    () => localStorage.getItem("homepage.locked") === "true",
  );
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [resizingId, setResizingId] = useState<number | null>(null);
  const [editingWidget, setEditingWidget] = useState<CanvasWidget | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    screenX: 0,
    screenY: 0,
    canvasX: 0,
    canvasY: 0,
  });
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const [loading, setLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const widgetsRef = useRef(widgets);
  panRef.current = pan;
  zoomRef.current = zoom;
  widgetsRef.current = widgets;

  const hasFitRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getHomepageItems(), getHomepageLayout()])
      .then(([items, layoutRow]) => {
        if (cancelled) return;
        const layoutEntries = layoutRow?.layout?.entries ?? [];
        const merged: CanvasWidget[] = items.map((item) => {
          const entry = layoutEntries.find((e) => e.itemId === item.id);
          const typeDef = getWidgetType(item.typeId as WidgetTypeId);
          return {
            id: item.id,
            typeId: item.typeId as WidgetTypeId,
            title: item.title,
            config: JSON.parse(item.config || "{}"),
            x: entry?.x ?? snapToGrid(Math.random() * 600 + 100),
            y: entry?.y ?? snapToGrid(Math.random() * 400 + 100),
            w: entry?.w ?? typeDef?.defaultSize.w ?? GRID_SIZE * 8,
            h: entry?.h ?? typeDef?.defaultSize.h ?? GRID_SIZE * 6,
            zOrder: entry?.zOrder ?? 0,
          };
        });
        setWidgets(merged);
        if (layoutRow?.layout?.pan) setPan(layoutRow.layout.pan);
        if (layoutRow?.layout?.zoom) setZoom(layoutRow.layout.zoom);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scheduleSave = useCallback(
    (newWidgets?: CanvasWidget[], newPan?: typeof pan, newZoom?: number) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const ws = newWidgets ?? widgetsRef.current;
        const p = newPan ?? panRef.current;
        const z = newZoom ?? zoomRef.current;
        saveHomepageLayout({
          entries: ws.map((w) => ({
            itemId: w.id,
            x: w.x,
            y: w.y,
            w: w.w,
            h: w.h,
            zOrder: w.zOrder,
          })),
          pan: p,
          zoom: z,
        }).catch(() => {});
      }, 500);
    },
    [],
  );

  useEffect(() => {
    if (!fitOnLoad || loading || widgets.length === 0 || hasFitRef.current)
      return;
    const el = containerRef.current;
    if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
    hasFitRef.current = true;
    const vw = el.offsetWidth;
    const vh = el.offsetHeight;
    const minX = Math.min(...widgets.map((w) => w.x));
    const minY = Math.min(...widgets.map((w) => w.y));
    const maxX = Math.max(...widgets.map((w) => w.x + w.w));
    const maxY = Math.max(...widgets.map((w) => w.y + w.h));
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const PADDING = 48;
    const fz = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min((vw - PADDING * 2) / contentW, (vh - PADDING * 2) / contentH),
      ),
    );
    setPan({
      x: (vw - contentW * fz) / 2 - minX * fz,
      y: (vh - contentH * fz) / 2 - minY * fz,
    });
    setZoom(fz);
  }, [fitOnLoad, loading, widgets, containerSize]);

  const handlePanChange = useCallback(
    (newPan: typeof pan) => {
      setPan(newPan);
      scheduleSave(undefined, newPan, undefined);
    },
    [scheduleSave],
  );

  const handleZoomChange = useCallback(
    (newZoom: number, newPan: typeof pan) => {
      setZoom(newZoom);
      setPan(newPan);
      scheduleSave(undefined, newPan, newZoom);
    },
    [scheduleSave],
  );

  const canvasInput = useCanvasInput({
    isDraggingWidget: draggingId !== null,
    isResizing: resizingId !== null,
    isContextMenuVisible: contextMenu.visible,
    onPanChange: handlePanChange,
    onZoomChange: handleZoomChange,
    getPan: () => panRef.current,
    getZoom: () => zoomRef.current,
    containerRef,
  });

  const handleWidgetMove = useCallback(
    (id: number, x: number, y: number) => {
      setWidgets((prev) => {
        const next = prev.map((w) => (w.id === id ? { ...w, x, y } : w));
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const handleWidgetResize = useCallback(
    (id: number, w: number, h: number) => {
      setWidgets((prev) => {
        const next = prev.map((widget) =>
          widget.id === id ? { ...widget, w, h } : widget,
        );
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const handleDragStart = useCallback(
    (id: number) => {
      setDraggingId(id);
      setWidgets((prev) => {
        const widget = prev.find((w) => w.id === id);
        if (!widget || widget.typeId === "folder") return prev;
        const top = nextZOrder(prev);
        const next = prev.map((w) => (w.id === id ? { ...w, zOrder: top } : w));
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const { startDrag } = useBoxDrag({
    widgets,
    zoom,
    getZoom: () => zoomRef.current,
    onWidgetMove: handleWidgetMove,
    onDragStart: handleDragStart,
    onDragEnd: () => setDraggingId(null),
  });

  const { startResize } = useBoxResize({
    widgets,
    getZoom: () => zoomRef.current,
    onWidgetResize: handleWidgetResize,
    onResizeStart: setResizingId,
    onResizeEnd: () => setResizingId(null),
  });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (isLocked || isReadOnly) return;
      if ((e.target as HTMLElement).closest("[data-widget]")) return;
      e.preventDefault();
      const rect = containerRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x, y } = screenToCanvas(sx, sy, panRef.current, zoomRef.current);
      setContextMenu({
        visible: true,
        screenX: e.clientX,
        screenY: e.clientY,
        canvasX: snapToGrid(x),
        canvasY: snapToGrid(y),
      });
    },
    [isLocked, isReadOnly],
  );

  const handleAddWidget = useCallback(
    async (typeId: WidgetTypeId, canvasX: number, canvasY: number) => {
      const typeDef = getWidgetType(typeId);
      if (!typeDef) return;
      try {
        const item = await createHomepageItem({
          typeId,
          config: typeDef.defaultConfig as Record<string, unknown>,
        });
        setWidgets((prev) => {
          const zOrder = typeId === "folder" ? 0 : nextZOrder(prev);
          const newWidget: CanvasWidget = {
            id: item.id,
            typeId,
            title: item.title,
            config: typeDef.defaultConfig as Record<string, unknown>,
            x: canvasX,
            y: canvasY,
            w: typeDef.defaultSize.w,
            h: typeDef.defaultSize.h,
            zOrder,
          };
          const next = [...prev, newWidget];
          scheduleSave(next);
          return next;
        });
      } catch {}
    },
    [scheduleSave],
  );

  const handleOpenAddMenu = useCallback(
    (anchorRect: {
      top: number;
      bottom: number;
      left: number;
      right: number;
      width: number;
      height: number;
    }) => {
      const w = containerSize.w;
      const h = containerSize.h;
      const { x, y } = screenToCanvas(
        w / 2,
        h / 2,
        panRef.current,
        zoomRef.current,
      );
      setContextMenu({
        visible: true,
        screenX: anchorRect.left,
        screenY: anchorRect.top,
        canvasX: snapToGrid(x),
        canvasY: snapToGrid(y),
        anchorRect,
      });
    },
    [containerSize],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteHomepageItem(id);
        setWidgets((prev) => {
          const next = prev.filter((w) => w.id !== id);
          scheduleSave(next);
          return next;
        });
      } catch {}
    },
    [scheduleSave],
  );

  const handleEdit = useCallback(
    (id: number) => {
      const w = widgets.find((x) => x.id === id);
      if (w) {
        setEditingWidget(w);
        setDialogKey((k) => k + 1);
      }
    },
    [widgets],
  );

  const handleSaveEdit = useCallback(
    async (
      id: number,
      title: string | null,
      config: Record<string, unknown>,
    ) => {
      try {
        await updateHomepageItem(id, { title, config });
        setWidgets((prev) =>
          prev.map((w) => (w.id === id ? { ...w, title, config } : w)),
        );
      } catch {}
    },
    [],
  );

  const resetView = useCallback(() => {
    const ws = widgetsRef.current;
    const el = containerRef.current;
    const vw = el?.offsetWidth ?? 800;
    const vh = el?.offsetHeight ?? 600;

    if (ws.length === 0) {
      setPan(DEFAULT_PAN);
      setZoom(DEFAULT_ZOOM);
      return;
    }

    const minX = Math.min(...ws.map((w) => w.x));
    const minY = Math.min(...ws.map((w) => w.y));
    const maxX = Math.max(...ws.map((w) => w.x + w.w));
    const maxY = Math.max(...ws.map((w) => w.y + w.h));
    const contentW = maxX - minX;
    const contentH = maxY - minY;

    const PADDING = 48;
    const fitZoom = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min((vw - PADDING * 2) / contentW, (vh - PADDING * 2) / contentH),
      ),
    );

    // Place the content bbox center at the viewport center
    const newPan = {
      x: (vw - contentW * fitZoom) / 2 - minX * fitZoom,
      y: (vh - contentH * fitZoom) / 2 - minY * fitZoom,
    };

    setZoom(fitZoom);
    setPan(newPan);
    scheduleSave(undefined, newPan, fitZoom);
  }, [scheduleSave]);

  // Folders always render first (lowest z), non-folders sorted by zOrder ascending
  const sortedWidgets = [...widgets].sort((a, b) => {
    const aFolder = a.typeId === "folder";
    const bFolder = b.typeId === "folder";
    if (aFolder && !bFolder) return -1;
    if (!aFolder && bFolder) return 1;
    return a.zOrder - b.zOrder;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-muted-foreground text-sm">
        {t("homepage.loading")}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-background"
      onMouseDown={editingWidget ? undefined : canvasInput.handleMouseDown}
      onMouseMove={canvasInput.handleMouseMove}
      onMouseUp={canvasInput.handleMouseUp}
      onMouseLeave={canvasInput.handleMouseUp}
      onWheel={canvasInput.handleWheel}
      onContextMenu={handleContextMenu}
      style={{ cursor: draggingId ? "grabbing" : "default" }}
    >
      <CanvasDotBackground pan={pan} zoom={zoom} />

      <div
        className="absolute origin-top-left"
        style={{
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          willChange: "transform",
        }}
      >
        {sortedWidgets.map((widget) => (
          <WidgetShell
            key={widget.id}
            widget={widget}
            isLocked={isLocked}
            isReadOnly={isReadOnly}
            isDragging={draggingId === widget.id}
            isResizing={resizingId === widget.id}
            onStartDrag={startDrag}
            onStartResize={startResize}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onConfigUpdate={(config) =>
              handleSaveEdit(widget.id, widget.title, config)
            }
          />
        ))}
      </div>

      {widgets.length === 0 && !isReadOnly && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <div className="flex items-center gap-2 bg-card border border-border px-3 py-2 shadow-sm">
            <LayoutGrid className="size-3.5 text-muted-foreground/50 shrink-0" />
            <span className="text-xs text-muted-foreground/70">
              {t("homepage.noWidgets")}
            </span>
          </div>
        </div>
      )}

      {isReadOnly && onOpenFullscreen && (
        <button
          className="absolute top-2 right-2 z-20 text-xs text-muted-foreground hover:text-foreground bg-card/80 border border-border px-2 py-1"
          onClick={onOpenFullscreen}
        >
          {t("homepage.openFullView")}
        </button>
      )}

      {!isReadOnly && (
        <HomepageToolbar
          zoom={zoom}
          isLocked={isLocked}
          pan={pan}
          containerSize={containerSize}
          onZoomChange={handleZoomChange}
          onLockToggle={() =>
            setIsLocked((v) => {
              const next = !v;
              localStorage.setItem("homepage.locked", String(next));
              return next;
            })
          }
          onResetView={resetView}
          onAddWidget={handleOpenAddMenu}
        />
      )}

      <AddWidgetMenu
        state={contextMenu}
        onAdd={handleAddWidget}
        onClose={() => setContextMenu((s) => ({ ...s, visible: false }))}
      />

      <WidgetEditDialog
        key={dialogKey}
        widget={editingWidget}
        onSave={handleSaveEdit}
        onClose={() => setEditingWidget(null)}
      />
    </div>
  );
}
