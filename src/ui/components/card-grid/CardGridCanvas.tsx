import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  GripVertical,
  Trash2,
  Plus,
  Columns2,
  StretchHorizontal,
} from "lucide-react";
import type { GridSlot, GridCardCatalogEntry } from "./types";
import {
  MAX_COLUMNS,
  MIN_COLUMNS,
  clampColumns,
  nextColSpan,
  sortSlots,
  reorderSlots,
  addSlot,
  removeSlot,
  setColSpan,
  setHeight,
  heightToRowSpan,
} from "./layout-utils";

type DragState = { id: string; order: number } | null;

/**
 * Masonry is implemented with the CSS-grid row-span trick: the grid has many
 * tiny rows (`ROW_UNIT`px each) and every tile spans `ceil(height / ROW_UNIT)`
 * rows. With `grid-auto-flow: row dense` the browser packs short tiles under
 * tall ones (tetris) while still honouring multi-column spans natively.
 */
const ROW_UNIT = 8;
const ROW_GAP = 12;

function DropZone({
  order,
  active,
  onDropAt,
  onDragOver,
}: {
  order: number;
  active: boolean;
  onDropAt: (order: number) => void;
  onDragOver: (e: DragEvent) => void;
}) {
  const [over, setOver] = useState(false);
  if (!active) return null;
  return (
    <div
      className={cn(
        "transition-all duration-150",
        over
          ? "h-16 border-2 border-dashed border-accent-brand/60 bg-accent-brand/5"
          : "h-3",
      )}
      onDragOver={(e) => {
        onDragOver(e);
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={() => {
        setOver(false);
        onDropAt(order);
      }}
    />
  );
}

function TileChrome({
  columns,
  label,
  onRemove,
  onCycleWidth,
  onResizeStart,
}: {
  columns: number;
  label: string;
  onRemove: () => void;
  onCycleWidth: () => void;
  onResizeStart: (e: ReactMouseEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-10 border-2 border-dashed border-accent-brand/30" />
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
        <div
          className="flex size-6 cursor-grab items-center justify-center border border-border bg-card active:cursor-grabbing"
          title={t("cardGrid.dragToMove")}
        >
          <GripVertical className="size-3 text-muted-foreground" />
        </div>
        {columns > 1 && (
          <button
            onClick={onCycleWidth}
            className="flex size-6 items-center justify-center border border-border bg-card transition-colors hover:border-accent-brand/40 hover:bg-accent-brand/10"
            title={t("cardGrid.changeWidth")}
          >
            <Columns2 className="size-3 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={onRemove}
          className="flex size-6 items-center justify-center border border-border bg-card transition-colors hover:border-destructive/40 hover:bg-destructive/10"
          title={t("cardGrid.removeCard", { label })}
        >
          <Trash2 className="size-3 text-muted-foreground" />
        </button>
      </div>
      <div
        onMouseDown={onResizeStart}
        className="group/resize absolute bottom-0 left-0 right-0 z-20 flex h-2.5 cursor-row-resize items-center justify-center"
        title={t("cardGrid.dragToResize")}
      >
        <div className="h-0.5 w-12 rounded-full bg-border transition-colors group-hover/resize:bg-accent-brand/60" />
      </div>
    </>
  );
}

function AddTray({
  catalog,
  presentIds,
  onAdd,
}: {
  catalog: GridCardCatalogEntry[];
  presentIds: Set<string>;
  onAdd: (entry: GridCardCatalogEntry) => void;
}) {
  const { t } = useTranslation();
  const available = catalog.filter((c) => !presentIds.has(c.id));
  if (available.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {t("cardGrid.addCard")}
      </span>
      {available.map((card) => (
        <button
          key={card.id}
          onClick={() => onAdd(card)}
          title={card.description}
          className="flex items-center gap-1.5 border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-accent-brand/60 hover:bg-accent-brand/5 hover:text-foreground"
        >
          <Plus className="size-3 text-accent-brand" />
          {card.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One masonry tile. Measures its natural (or overridden) height and reports the
 * number of grid rows it should span so the parent grid can pack densely.
 */
function MasonryTile({
  slot,
  span,
  rows,
  editMode,
  isDragging,
  effectiveColumns,
  label,
  measureRef,
  children,
  onReportRows,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onRemove,
  onCycleWidth,
  onResizeStart,
}: {
  slot: GridSlot;
  span: number;
  rows: number;
  editMode: boolean;
  isDragging: boolean;
  effectiveColumns: number;
  label: string;
  measureRef: (el: HTMLDivElement | null) => void;
  children: ReactNode;
  onReportRows: (rows: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: () => void;
  onRemove: () => void;
  onCycleWidth: () => void;
  onResizeStart: (e: ReactMouseEvent) => void;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const fixedHeight = slot.height ?? undefined;

  // Report the span (in row units) from the measured content height. When an
  // explicit height override is set we derive rows from it directly.
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const report = () => {
      const h = fixedHeight ?? el.getBoundingClientRect().height;
      onReportRows(heightToRowSpan(h, ROW_UNIT, ROW_GAP));
    };
    report();
    if (fixedHeight != null) return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedHeight, span, effectiveColumns]);

  return (
    <div
      ref={measureRef}
      draggable={editMode}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "relative flex min-w-0 flex-col transition-opacity",
        editMode && "select-none",
        isDragging ? "opacity-40" : "opacity-100",
      )}
      style={{
        gridColumn: `span ${span} / span ${span}`,
        gridRow: `span ${rows} / span ${rows}`,
      }}
    >
      <div
        ref={innerRef}
        className={cn(
          "min-h-0",
          fixedHeight != null && "overflow-hidden [&>*]:h-full",
        )}
        style={fixedHeight != null ? { height: fixedHeight } : undefined}
      >
        {children}
      </div>
      {editMode && (
        <TileChrome
          columns={effectiveColumns}
          label={label}
          onRemove={onRemove}
          onCycleWidth={onCycleWidth}
          onResizeStart={onResizeStart}
        />
      )}
    </div>
  );
}

interface CardGridCanvasProps {
  slots: GridSlot[];
  columns: number;
  editMode: boolean;
  /** Render the card body for a given slot id. */
  renderCard: (id: string) => ReactNode;
  /** Cards available to add in edit mode (already-present ones are filtered out). */
  cardCatalog: GridCardCatalogEntry[];
  onChange: (slots: GridSlot[], columns: number) => void;
  /** Human label lookup for a card id (used by remove/add chrome). */
  cardLabel?: (id: string) => string;
  className?: string;
}

export function CardGridCanvas({
  slots,
  columns,
  editMode,
  renderCard,
  cardCatalog,
  onChange,
  cardLabel,
  className,
}: CardGridCanvasProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [dragState, setDragState] = useState<DragState>(null);
  const [rowSpans, setRowSpans] = useState<Record<string, number>>({});
  const tileRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const sorted = sortSlots(slots);
  const presentIds = new Set(slots.map((s) => s.id));
  const labelFor = useCallback(
    (id: string) => cardLabel?.(id) ?? id,
    [cardLabel],
  );

  // Drop row-span entries for cards that are no longer present.
  useEffect(() => {
    setRowSpans((prev) => {
      const next: Record<string, number> = {};
      let changed = false;
      for (const s of slots) {
        if (prev[s.id] != null) next[s.id] = prev[s.id];
        else changed = true;
      }
      if (Object.keys(next).length !== Object.keys(prev).length) changed = true;
      return changed ? next : prev;
    });
  }, [slots]);

  const reportRows = useCallback((id: string, rows: number) => {
    setRowSpans((prev) => (prev[id] === rows ? prev : { ...prev, [id]: rows }));
  }, []);

  const commitSlots = useCallback(
    (next: GridSlot[]) => onChange(next, columns),
    [onChange, columns],
  );

  const handleDropAt = useCallback(
    (targetOrder: number) => {
      if (!dragState) return;
      commitSlots(reorderSlots(slots, dragState.id, targetOrder));
      setDragState(null);
    },
    [dragState, slots, commitSlots],
  );

  const handleRemove = useCallback(
    (id: string) => commitSlots(removeSlot(slots, id)),
    [slots, commitSlots],
  );

  const handleAdd = useCallback(
    (entry: GridCardCatalogEntry) =>
      commitSlots(addSlot(slots, entry, columns)),
    [slots, columns, commitSlots],
  );

  const handleCycleWidth = useCallback(
    (id: string) => {
      const slot = slots.find((s) => s.id === id);
      if (!slot) return;
      commitSlots(setColSpan(slots, id, nextColSpan(slot.colSpan, columns)));
    },
    [slots, columns, commitSlots],
  );

  const handleResizeStart = useCallback(
    (id: string, e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startH =
        tileRefs.current.get(id)?.getBoundingClientRect().height ?? 120;
      const onMove = (ev: globalThis.MouseEvent) => {
        onChange(setHeight(slots, id, startH + (ev.clientY - startY)), columns);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [slots, columns, onChange],
  );

  const handleDragOver = (e: DragEvent) => e.preventDefault();

  // Mobile: simple single-column stack, no DnD / resize / edit chrome.
  if (isMobile) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        {sorted.map((slot) => (
          <div key={slot.id} className="w-full">
            {renderCard(slot.id)}
          </div>
        ))}
      </div>
    );
  }

  const effectiveColumns = clampColumns(columns);

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className="grid items-start"
        style={{
          gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_UNIT}px`,
          gridAutoFlow: "row dense",
          columnGap: `${ROW_GAP}px`,
          rowGap: `${ROW_GAP}px`,
        }}
      >
        {sorted.map((slot) => {
          const span = Math.min(slot.colSpan, effectiveColumns);
          const isDragging = dragState?.id === slot.id;
          const rows = rowSpans[slot.id] ?? 24;
          return (
            <MasonryTile
              key={slot.id}
              slot={slot}
              span={span}
              rows={rows}
              editMode={editMode}
              isDragging={isDragging}
              effectiveColumns={effectiveColumns}
              label={labelFor(slot.id)}
              measureRef={(el) => {
                tileRefs.current.set(slot.id, el);
              }}
              onReportRows={(r) => reportRows(slot.id, r)}
              onDragStart={() =>
                setDragState({ id: slot.id, order: slot.order })
              }
              onDragEnd={() => setDragState(null)}
              onDragOver={handleDragOver}
              onDrop={() => handleDropAt(slot.order)}
              onRemove={() => handleRemove(slot.id)}
              onCycleWidth={() => handleCycleWidth(slot.id)}
              onResizeStart={(e) => handleResizeStart(slot.id, e)}
            >
              {renderCard(slot.id)}
            </MasonryTile>
          );
        })}
      </div>

      {editMode && (
        <>
          {sorted.length === 0 && (
            <div className="flex items-center justify-center border border-dashed border-border/40 py-10 text-xs text-muted-foreground/40">
              {t("cardGrid.empty")}
            </div>
          )}
          <AddTray
            catalog={cardCatalog}
            presentIds={presentIds}
            onAdd={handleAdd}
          />
        </>
      )}

      {/* Drop target covering the end of the grid while dragging. */}
      {editMode && (
        <DropZone
          order={sorted.length}
          active={!!dragState}
          onDropAt={handleDropAt}
          onDragOver={handleDragOver}
        />
      )}
    </div>
  );
}

/** Small stepper to change the masonry column count, for an edit toolbar. */
export function ColumnCountStepper({
  columns,
  onChange,
}: {
  columns: number;
  onChange: (columns: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      <StretchHorizontal className="size-3.5 text-muted-foreground" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {t("cardGrid.columns")}
      </span>
      <div className="flex items-center border border-border">
        <button
          className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
          disabled={columns <= MIN_COLUMNS}
          onClick={() => onChange(clampColumns(columns - 1))}
        >
          −
        </button>
        <span className="w-6 text-center text-xs font-bold tabular-nums">
          {columns}
        </span>
        <button
          className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
          disabled={columns >= MAX_COLUMNS}
          onClick={() => onChange(clampColumns(columns + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}
