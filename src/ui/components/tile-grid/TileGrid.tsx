import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { GripVertical, Settings2, X } from "lucide-react";
import { remScale } from "@/lib/rem";
import { cn } from "@/lib/utils";
import {
  MAX_TILE_HEIGHT,
  MIN_TILE_COLUMNS,
  MIN_TILE_HEIGHT,
  TILE_COLUMNS,
  clampTileColumns,
  settleTiles,
  tileBottom,
  tileBoxes,
  tilesFromBoxes,
  type TileBox,
  type TileSlot,
} from "./layout";
import { SeamlessTileContext } from "./context";
import { gridLines } from "./layout";
import { scrollParent } from "./edge";

type Edge = "left" | "right" | "bottom" | "corner";
interface Proposal {
  x?: number;
  y?: number;
  w?: number;
  h?: number | null;
}
interface Interaction {
  id: string;
  kind: "move" | "resize";
  base: TileSlot[];
  proposal: Proposal;
  frame: { left: number; top: number; width: number; height?: number };
}

const DRAG_THRESHOLD = 4;
const SNAP = 8;
const SCROLL_EDGE = 48;

const styles = `
.tg-grid { position: relative; }
.tg-tile { position: absolute; left: 0; top: 0; min-width: 0; display: flex; flex-direction: column; }
.tg-grid[data-animate="true"] .tg-tile:not([data-active]) { transition: transform 160ms ease, width 160ms ease, height 160ms ease; }
.tg-tile[data-active] { z-index: 40; }
.tg-tile[data-active="move"] { opacity: 0.85; cursor: grabbing; }
.tg-grid[data-edit-mode="true"] .tg-tile { user-select: none; }
.tg-grid[data-edit-mode="true"] .tg-tile:not([data-active]) { cursor: grab; }
[data-tg-drop-preview] {
  position: absolute; left: 0; top: 0; z-index: 5; pointer-events: none; box-sizing: border-box;
  background: color-mix(in srgb, var(--accent-brand, #60a5fa) 12%, transparent);
  border: 2px dashed color-mix(in srgb, var(--accent-brand, #60a5fa) 70%, transparent);
}
.tg-handle { position: absolute; z-index: 30; display: flex; touch-action: none; align-items: center; justify-content: center; }
.tg-handle > span { background: var(--border); }
.tg-handle:hover > span { background: var(--accent-brand, #60a5fa); }
.tg-edge-left, .tg-edge-right { top: 2rem; bottom: 1rem; width: 0.75rem; cursor: ew-resize; }
.tg-edge-left { left: 0; }
.tg-edge-right { right: 0; }
.tg-edge-bottom { bottom: 0; left: 1rem; right: 1rem; height: 0.75rem; cursor: ns-resize; }
.tg-edge-corner { bottom: 0; right: 0; width: 1rem; height: 1rem; cursor: nwse-resize; }
.tg-edge-corner::after { content: ""; width: 0.5rem; height: 0.5rem; border-right: 2px solid var(--border); border-bottom: 2px solid var(--border); }
.tg-handle:focus-visible { outline: 2px solid var(--accent-brand, #60a5fa); }
.tg-card[data-fixed-height="true"] { height: 100%; }
.tg-card[data-fixed-height="true"] > .tg-content { overflow: hidden; }
.tg-card[data-fixed-height="true"] > .tg-content > * { height: 100%; }
`;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function propose(base: TileSlot[], id: string, proposal: Proposal) {
  return base.map((slot) => (slot.id === id ? { ...slot, ...proposal } : slot));
}

const NO_DRAG =
  "button, a, input, select, textarea, label, [role=separator], [contenteditable=true], .tg-handle";

export interface TileGridProps {
  slots: TileSlot[];
  editMode: boolean;
  renderTile: (id: string) => ReactNode;
  /** Name of a tile, for the edit controls. */
  tileLabel: (id: string) => string;
  onChange: (slots: TileSlot[]) => void;
  /** Shows a settings button on each tile while editing. */
  onSettings?: (id: string) => void;
  /** Space between tiles in px. 0 draws tiles edge to edge with shared borders, like the dashboard. */
  gap?: number;
  /** Below this width tiles stack in one column and editing is off. */
  stackBelow?: number;
  minColumns?: number;
  minHeight?: number;
  /** Shown while editing an empty grid. */
  empty?: ReactNode;
  className?: string;
}

/**
 * A 12 column grid of tiles the user can drag and resize. Tiles keep their
 * column and settle upward, so a layout never has holes it did not ask for.
 */
export function TileGrid({
  slots,
  editMode,
  renderTile,
  tileLabel,
  onChange,
  onSettings,
  gap = 0,
  stackBelow = 640,
  minColumns = MIN_TILE_COLUMNS,
  minHeight = MIN_TILE_HEIGHT,
  empty,
  className,
}: TileGridProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const gridEl = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // Whether the grid reaches the bottom of the view it scrolls in. Then its
  // last row meets the bottom of the screen and needs no line under it.
  const [overflows, setOverflows] = useState(false);
  const overflowsRef = useRef(overflows);
  overflowsRef.current = overflows;
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [active, setActive] = useState<Interaction | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const heightsRef = useRef(heights);
  heightsRef.current = heights;

  const scale = remScale();
  const seamless = gap <= 0;
  // Edge to edge tiles draw no lines of their own. The grid works out every
  // line between them and draws each once, so a line is never doubled at any
  // display scaling and a taller neighbour still gets its edge.
  const inset = seamless ? 0 : gap * scale;
  const settleGap = seamless ? 0 : gap;
  const pitch = (width + inset) / TILE_COLUMNS;
  const stacked = width > 0 && width < stackBelow;
  const editing = editMode && !stacked;

  const settled = useMemo(
    () => settleTiles(tileBoxes(slots, heights), settleGap),
    [slots, heights, settleGap],
  );
  const preview = useMemo(
    () =>
      active
        ? settleTiles(
            tileBoxes(
              propose(active.base, active.id, active.proposal),
              heights,
            ),
            settleGap,
          )
        : settled,
    [active, settled, heights, settleGap],
  );
  const boxById = useMemo(
    () => new Map(preview.map((box) => [box.id, box])),
    [preview],
  );
  // Same elements across pointer moves, so tiles only re-render on new data.
  const content = useMemo(
    () =>
      new Map<string, ReactNode>(
        slots.map((slot) => [slot.id, renderTile(slot.id)]),
      ),
    [slots, renderTile],
  );

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const update = () =>
      setWidth(element.getBoundingClientRect().width || element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = root.current;
    const scroller = seamless ? scrollParent(element) : null;
    if (!element || !scroller) {
      setOverflows(false);
      return;
    }
    // Where the grid's last row ends inside the scrolled content, without the
    // kept bottom line's px, so adding or dropping that line never flips it.
    const update = () => {
      const end =
        element.getBoundingClientRect().bottom -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        (overflowsRef.current ? 0 : 1);
      setOverflows(end >= scroller.clientHeight - 0.5);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    observer.observe(element);
    return () => observer.disconnect();
  }, [seamless, settled, width]);

  // An outside change (undo, reset, host switch) ends any drag in progress.
  useEffect(() => () => cancel.current?.(), [slots, editing]);

  const reportHeight = useCallback(
    (id: string, height: number) =>
      setHeights((previous) =>
        Math.abs((previous[id] ?? -1) - height) < 0.5
          ? previous
          : { ...previous, [id]: height },
      ),
    [],
  );

  const commit = (base: TileSlot[], id: string | null, proposal: Proposal) => {
    const next = id ? propose(base, id, proposal) : base;
    const boxes = settleTiles(tileBoxes(next, heightsRef.current), settleGap);
    onChange(tilesFromBoxes(next, boxes));
  };
  const settledBase = (): TileSlot[] =>
    slots.map((slot) => ({
      ...slot,
      y: settled.find((box) => box.id === slot.id)?.y ?? slot.y,
    }));

  const begin = (
    event: ReactPointerEvent<HTMLElement>,
    id: string,
    edge?: Edge,
  ) => {
    if (event.button !== 0 || !editing || cancel.current) return;
    const element = gridEl.current;
    const box = settled.find((b) => b.id === id);
    const slot = slots.find((s) => s.id === id);
    if (!element || !box || !slot) return;
    if (!edge) {
      const target = event.target as HTMLElement;
      if (target.closest(NO_DRAG) && !target.closest("[data-tg-grip]")) return;
      const native = event.nativeEvent;
      const scrolls =
        target.scrollHeight > target.clientHeight ||
        target.scrollWidth > target.clientWidth;
      if (
        scrolls &&
        (native.offsetX > target.clientWidth ||
          native.offsetY > target.clientHeight)
      )
        return;
    } else {
      event.preventDefault();
      event.stopPropagation();
    }
    const kind = edge ? "resize" : "move";
    const base = settledBase();
    const origin = element.getBoundingClientRect();
    const startLeft = box.x * pitch;
    const startTop = box.y * scale;
    const startWidth = box.w * pitch - inset;
    const startHeight = box.h * scale;
    const fixed = slot.h != null;
    const startX = event.clientX;
    const startY = event.clientY;
    const grabX = startX - origin.left - startLeft;
    const grabY = startY - origin.top - startTop;
    const scroller = scrollParent(element);
    const others = settled.filter((b) => b.id !== id);
    let pointer = { x: startX, y: startY };
    let started = kind === "resize";
    let current: Interaction | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    const compute = (): Interaction => {
      const rect = element.getBoundingClientRect();
      if (kind === "move") {
        const left = pointer.x - rect.left - grabX;
        const top = pointer.y - rect.top - grabY;
        return {
          id,
          kind,
          base,
          proposal: {
            x: clamp(Math.round(left / pitch), 0, TILE_COLUMNS - box.w),
            y: Math.max(0, top / scale),
          },
          frame: {
            left,
            top,
            width: startWidth,
            height: fixed ? startHeight : undefined,
          },
        };
      }
      const dx = pointer.x - startX;
      const dy = pointer.y - rect.top - (startY - origin.top);
      const proposal: Proposal = {};
      const frame: Interaction["frame"] = {
        left: startLeft,
        top: startTop,
        width: startWidth,
        height: fixed ? startHeight : undefined,
      };
      const minWidth = minColumns * pitch - inset;
      if (edge === "right" || edge === "corner") {
        const raw = clamp(
          startWidth + dx,
          minWidth,
          (TILE_COLUMNS - box.x) * pitch - inset,
        );
        proposal.w = Math.min(
          clampTileColumns((raw + inset) / pitch, minColumns),
          TILE_COLUMNS - box.x,
        );
        frame.width = raw;
      }
      if (edge === "left") {
        const right = box.x + box.w;
        const raw = clamp(startWidth - dx, minWidth, right * pitch - inset);
        proposal.w = Math.min(
          clampTileColumns((raw + inset) / pitch, minColumns),
          right,
        );
        proposal.x = right - proposal.w;
        frame.width = raw;
        frame.left = startLeft + startWidth - raw;
      }
      if (edge === "bottom" || edge === "corner") {
        let height =
          clamp(startHeight + dy, minHeight * scale, MAX_TILE_HEIGHT * scale) /
          scale;
        // Line up with the bottom of a nearby tile.
        for (const other of others) {
          const bottom = other.y + other.h - box.y;
          if (bottom >= minHeight && Math.abs(bottom - height) <= SNAP) {
            height = bottom;
            break;
          }
        }
        proposal.h = Math.round(height);
        frame.height = proposal.h * scale;
      }
      return { id, kind, base, proposal, frame };
    };
    const update = () => {
      current = compute();
      setActive(current);
    };
    const autoScroll = () => {
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect();
      const step =
        pointer.y < rect.top + SCROLL_EDGE
          ? -12
          : pointer.y > rect.bottom - SCROLL_EDGE
            ? 12
            : 0;
      if (!step) return;
      const before = scroller.scrollTop;
      scroller.scrollTop += step;
      if (scroller.scrollTop !== before) update();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      pointer = { x: e.clientX, y: e.clientY };
      if (
        !started &&
        Math.hypot(pointer.x - startX, pointer.y - startY) < DRAG_THRESHOLD
      )
        return;
      if (!started) {
        started = true;
        window.getSelection?.()?.removeAllRanges();
        if (scroller) timer = setInterval(autoScroll, 16);
      }
      update();
    };
    const finish = (save: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelled);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
      clearInterval(timer);
      cancel.current = null;
      setActive(null);
      if (save && started && current) commit(base, id, current.proposal);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === event.pointerId) finish(true);
    };
    const cancelled = (e: PointerEvent) => {
      if (e.pointerId === event.pointerId) finish(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      finish(false);
    };
    const blur = () => finish(false);
    cancel.current = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelled);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    if (started) update();
  };

  const moveByKey = (event: ReactKeyboardEvent, id: string) => {
    const box = settled.find((b) => b.id === id);
    if (!box || !event.key.startsWith("Arrow")) return;
    const near = settled.filter(
      (b) => b.id !== id && b.x < box.x + box.w && box.x < b.x + b.w,
    );
    let proposal: Proposal | null = null;
    if (event.key === "ArrowLeft" && box.x > 0) proposal = { x: box.x - 1 };
    if (event.key === "ArrowRight" && box.x + box.w < TILE_COLUMNS)
      proposal = { x: box.x + 1 };
    if (event.key === "ArrowUp") {
      const above = near
        .filter((b) => b.y < box.y)
        .sort((a, b) => b.y - a.y)[0];
      if (above) proposal = { y: Math.max(0, above.y - 1) };
    }
    if (event.key === "ArrowDown") {
      const below = near
        .filter((b) => b.y > box.y)
        .sort((a, b) => a.y - b.y)[0];
      if (below) proposal = { y: below.y + 1 };
    }
    event.preventDefault();
    if (proposal) commit(settledBase(), id, proposal);
  };

  const resizeByKey = (
    event: ReactKeyboardEvent,
    id: string,
    axis: "width" | "height",
  ) => {
    const box = settled.find((b) => b.id === id);
    if (!box) return;
    const keys =
      axis === "width" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (![...keys, "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const sign = event.key === keys[1] ? 1 : -1;
    if (axis === "width") {
      const max = TILE_COLUMNS - box.x;
      const w =
        event.key === "Home"
          ? minColumns
          : event.key === "End"
            ? max
            : clamp(box.w + sign, minColumns, max);
      if (w !== box.w) commit(settledBase(), id, { w });
    } else {
      const current = Math.round(box.h);
      const h =
        event.key === "Home"
          ? minHeight
          : event.key === "End"
            ? MAX_TILE_HEIGHT
            : clamp(
                current + sign * (event.shiftKey ? 50 : 10),
                minHeight,
                MAX_TILE_HEIGHT,
              );
      if (h !== current) commit(settledBase(), id, { h });
    }
  };

  const remove = (id: string) =>
    commit(
      settledBase().filter((slot) => slot.id !== id),
      null,
      {},
    );

  if (stacked) {
    return (
      <SeamlessTileContext.Provider value={seamless}>
        <div
          ref={root}
          className={cn("flex flex-col", !seamless && "gap-3", className)}
        >
          {[...settled]
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((box) => (
              <div
                key={box.id}
                className={cn(
                  "w-full min-w-0",
                  seamless && "border-b border-border",
                )}
              >
                {content.get(box.id)}
              </div>
            ))}
        </div>
      </SeamlessTileContext.Provider>
    );
  }

  const activeBox = active ? boxById.get(active.id) : undefined;
  // Edge to edge tiles sit on whole px so the lines between them are crisp.
  const snap = (value: number) => (seamless ? Math.round(value) : value);
  const leftOf = (box: TileBox) => snap(box.x * pitch);
  const widthOf = (box: TileBox) =>
    seamless
      ? snap((box.x + box.w) * pitch) - snap(box.x * pitch)
      : box.w * pitch - inset;
  const bottom = tileBottom(preview, settleGap) * scale;
  // A kept bottom line sits one px under the last row.
  const height = Math.max(
    0,
    seamless ? snap(bottom) + (overflows ? 0 : 1) : bottom - inset,
  );
  const lines = seamless
    ? gridLines(
        preview.map((box) => ({
          l: leftOf(box),
          t: snap(box.y * scale),
          r: leftOf(box) + widthOf(box),
          b: snap((box.y + box.h) * scale),
        })),
        snap(width),
        overflows,
      )
    : [];

  return (
    <SeamlessTileContext.Provider value={seamless}>
      <div ref={root} className={className}>
        <div
          ref={gridEl}
          className="tg-grid"
          data-edit-mode={editing}
          data-animate={editing}
          style={{ height }}
        >
          <style>{styles}</style>
          {lines.map((line) => (
            <div
              key={`${line.x},${line.y},${line.w},${line.h}`}
              data-tg-line
              aria-hidden="true"
              // A real border, so it is as thin as every other line at any
              // display scaling; a 1 px fill rounds up to two screen px.
              className={cn(
                "pointer-events-none absolute z-[25] border-border",
                line.w === 1 ? "border-l" : "border-t",
              )}
              style={{
                left: line.x,
                top: line.y,
                width: line.w === 1 ? 0 : line.w,
                height: line.h === 1 ? 0 : line.h,
              }}
            />
          ))}
          {activeBox && (
            <div
              data-tg-drop-preview={activeBox.id}
              aria-hidden="true"
              style={{
                transform: `translate(${leftOf(activeBox)}px, ${snap(activeBox.y * scale)}px)`,
                width: widthOf(activeBox),
                height: activeBox.h * scale,
              }}
            />
          )}
          {slots.map((slot) => {
            const box = boxById.get(slot.id)!;
            const frame = active?.id === slot.id ? active.frame : null;
            const tileHeight = frame
              ? frame.height
              : seamless
                ? snap((box.y + box.h) * scale) - snap(box.y * scale)
                : slot.h != null
                  ? slot.h * scale
                  : undefined;
            return (
              <Tile
                key={slot.id}
                id={slot.id}
                box={box}
                label={tileLabel(slot.id)}
                editMode={editing}
                active={active?.id === slot.id ? active.kind : undefined}
                left={frame ? frame.left : leftOf(box)}
                top={frame ? frame.top : snap(box.y * scale)}
                width={frame ? frame.width : widthOf(box)}
                height={tileHeight}
                measure={slot.h == null}
                scale={scale}
                seamless={seamless}
                minColumns={minColumns}
                minHeight={minHeight}
                onHeight={reportHeight}
                onPointerDown={(event, edge) => begin(event, slot.id, edge)}
                onMoveKey={(event) => moveByKey(event, slot.id)}
                onResizeKey={(event, axis) => resizeByKey(event, slot.id, axis)}
                onSettings={onSettings ? () => onSettings(slot.id) : undefined}
                onRemove={() => remove(slot.id)}
              >
                {content.get(slot.id)}
              </Tile>
            );
          })}
        </div>
        {editing && slots.length === 0 && (
          <div className="flex items-center justify-center border border-dashed border-border py-10 text-xs text-muted-foreground">
            {empty ?? t("tileGrid.empty")}
          </div>
        )}
      </div>
    </SeamlessTileContext.Provider>
  );
}

function Tile({
  id,
  box,
  label,
  editMode,
  active,
  left,
  top,
  width,
  height,
  measure,
  scale,
  seamless,
  minColumns,
  minHeight,
  onHeight,
  onPointerDown,
  onMoveKey,
  onResizeKey,
  onSettings,
  onRemove,
  children,
}: {
  id: string;
  box: TileBox;
  label: string;
  editMode: boolean;
  active?: Interaction["kind"];
  left: number;
  top: number;
  width: number;
  height?: number;
  /** The tile has no height of its own and reports its content's. */
  measure: boolean;
  scale: number;
  seamless: boolean;
  minColumns: number;
  minHeight: number;
  onHeight: (id: string, height: number) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, edge?: Edge) => void;
  onMoveKey: (event: ReactKeyboardEvent) => void;
  onResizeKey: (event: ReactKeyboardEvent, axis: "width" | "height") => void;
  onSettings?: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const card = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const fixed = !measure;

  // Tiles with no height of their own report their content's so the grid can
  // place them. Edge to edge, that is rounded up to a whole px.
  useLayoutEffect(() => {
    const element = seamless ? body.current : card.current;
    if (!element || fixed) return;
    const report = () => {
      const own = element.getBoundingClientRect().height;
      onHeight(id, (seamless ? Math.ceil(own) : own) / scale);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [id, fixed, scale, seamless, onHeight]);

  const button =
    "flex size-6 items-center justify-center border border-border bg-card text-muted-foreground hover:text-foreground";

  return (
    <div
      data-tg-tile={id}
      data-active={active}
      className="tg-tile"
      style={{
        transform: `translate(${left}px, ${top}px)`,
        width,
        height,
      }}
      onPointerDown={editMode ? (event) => onPointerDown(event) : undefined}
    >
      <div
        ref={card}
        className={cn(
          "tg-card relative flex min-h-0 min-w-0 flex-col",
          seamless && "min-h-full",
        )}
        data-tg-card={id}
        data-fixed-height={fixed}
      >
        <div
          ref={body}
          className={cn(
            "tg-content min-h-0",
            seamless && measure ? "flex-none" : "flex-1",
          )}
        >
          {children}
        </div>
        {editMode && (
          <>
            <div className="pointer-events-none absolute inset-0 z-10 border-2 border-dashed border-accent-brand/30" />
            <div className="absolute top-1 right-1 z-20 flex items-center gap-1">
              <button
                type="button"
                className={cn(button, "cursor-grab active:cursor-grabbing")}
                title={t("tileGrid.move")}
                aria-label={t("tileGrid.moveTile", { tile: label })}
                onKeyDown={onMoveKey}
                data-tg-grip
              >
                <GripVertical className="size-3" />
              </button>
              {onSettings && (
                <button
                  type="button"
                  className={button}
                  title={t("tileGrid.settings", { tile: label })}
                  aria-label={t("tileGrid.settings", { tile: label })}
                  onClick={onSettings}
                >
                  <Settings2 className="size-3" />
                </button>
              )}
              <button
                type="button"
                onClick={onRemove}
                className={cn(
                  button,
                  "hover:border-destructive/40 hover:text-destructive",
                )}
                title={t("tileGrid.remove", { tile: label })}
                aria-label={t("tileGrid.remove", { tile: label })}
              >
                <X className="size-3" />
              </button>
            </div>
            <div
              className="tg-handle tg-edge-left"
              aria-hidden="true"
              onPointerDown={(event) => onPointerDown(event, "left")}
            />
            {(["width", "height"] as const).map((axis) => (
              <div
                key={axis}
                role="separator"
                tabIndex={0}
                aria-orientation={axis === "width" ? "vertical" : "horizontal"}
                aria-label={`${label}: ${t(axis === "width" ? "tileGrid.width" : "tileGrid.height")}`}
                aria-valuemin={axis === "width" ? minColumns : minHeight}
                aria-valuemax={
                  axis === "width" ? TILE_COLUMNS : MAX_TILE_HEIGHT
                }
                aria-valuenow={axis === "width" ? box.w : Math.round(box.h)}
                title={t(
                  axis === "width" ? "tileGrid.width" : "tileGrid.height",
                )}
                className={`tg-handle ${axis === "width" ? "tg-edge-right" : "tg-edge-bottom"}`}
                onPointerDown={(event) =>
                  onPointerDown(event, axis === "width" ? "right" : "bottom")
                }
                onKeyDown={(event) => onResizeKey(event, axis)}
              >
                <span
                  className={
                    axis === "width"
                      ? "h-12 w-0.5 rounded-full"
                      : "h-0.5 w-12 rounded-full"
                  }
                />
              </div>
            ))}
            <div
              className="tg-handle tg-edge-corner"
              aria-hidden="true"
              onPointerDown={(event) => onPointerDown(event, "corner")}
            />
          </>
        )}
      </div>
    </div>
  );
}
