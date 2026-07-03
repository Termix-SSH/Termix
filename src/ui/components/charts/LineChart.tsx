import { useRef, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

export interface LineChartSeries {
  key: string;
  label: string;
  /** CSS color string or var(--...) */
  color: string;
  data: Array<number | null>;
}

interface LineChartProps {
  series: LineChartSeries[];
  timestamps: string[];
  domain: [number, number];
  yFormatter?: (v: number) => string;
  height?: number;
  className?: string;
}

const Y_LABEL_W = 44;
const X_LABEL_H = 20;
const TOP_PAD = 6;
const TICK_COUNT = 5;

function parseTs(ts: string): Date {
  return new Date(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
}

function formatTimestamp(ts: string, rangeMs: number): string {
  const d = parseTs(ts);
  if (rangeMs <= 25 * 60 * 60 * 1000) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

function valToY(v: number, drawH: number, domain: [number, number]): number {
  const [lo, hi] = domain;
  const range = hi === lo ? 1 : hi - lo;
  return (
    TOP_PAD + drawH - ((Math.min(hi, Math.max(lo, v)) - lo) / range) * drawH
  );
}

function buildLinePath(
  data: Array<number | null>,
  w: number,
  drawH: number,
  domain: [number, number],
): string {
  const parts: string[] = [];
  let inSeg = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v == null) {
      inSeg = false;
      continue;
    }
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = valToY(v, drawH, domain);
    parts.push(
      inSeg
        ? `L${x.toFixed(1)},${y.toFixed(1)}`
        : `M${x.toFixed(1)},${y.toFixed(1)}`,
    );
    inSeg = true;
  }
  return parts.join(" ");
}

export function LineChart({
  series,
  timestamps,
  domain,
  yFormatter = (v) => String(v),
  height = 160,
  className,
}: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; index: number } | null>(
    null,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const chartW = Math.max(0, width - Y_LABEL_W);
  const drawH = height - TOP_PAD;
  const svgH = height + X_LABEL_H;

  const rangeMs =
    timestamps.length >= 2
      ? parseTs(timestamps[timestamps.length - 1]).getTime() -
        parseTs(timestamps[0]).getTime()
      : 0;

  const yTicks = (() => {
    const [lo, hi] = domain;
    const step = (hi - lo) / (TICK_COUNT - 1);
    return Array.from({ length: TICK_COUNT }, (_, i) => lo + i * step);
  })();

  const xTickIndices: number[] = [];
  if (timestamps.length > 1 && chartW > 0) {
    const n = timestamps.length;
    // Long labels ("Jun 28 14:30") are ~80px; short ("14:30") are ~40px.
    // Use at most 3 ticks for long labels, 5 for short, so they never crowd.
    const longLabel = rangeMs > 25 * 60 * 60 * 1000;
    const maxTicks = longLabel ? 3 : 5;
    const count = Math.min(maxTicks, n);
    for (let k = 0; k < count; k++) {
      xTickIndices.push(Math.round((k / (count - 1)) * (n - 1)));
    }
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGElement>) => {
      if (timestamps.length < 2 || chartW <= 0) return;
      const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
      const relX = e.clientX - rect.left - Y_LABEL_W;
      const index = Math.round(
        Math.max(0, Math.min(1, relX / chartW)) * (timestamps.length - 1),
      );
      setTooltip({ x: e.clientX - rect.left, index });
    },
    [timestamps.length, chartW],
  );

  return (
    <div
      ref={containerRef}
      className={cn("relative select-none w-full", className)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={svgH}
          style={{ display: "block" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        >
          {/* Grid lines + Y labels */}
          {yTicks.map((tick, ti) => {
            const y = valToY(tick, drawH, domain);
            return (
              <g key={ti}>
                <line
                  x1={Y_LABEL_W}
                  y1={y}
                  x2={width}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={1}
                  strokeOpacity={0.6}
                />
                <text
                  x={Y_LABEL_W - 6}
                  y={y + 4}
                  fontSize={10}
                  textAnchor="end"
                  fill="var(--muted-foreground)"
                >
                  {yFormatter(tick)}
                </text>
              </g>
            );
          })}

          {/* Left + bottom border */}
          <line
            x1={Y_LABEL_W}
            y1={TOP_PAD}
            x2={Y_LABEL_W}
            y2={TOP_PAD + drawH}
            stroke="var(--border)"
            strokeWidth={1}
          />
          <line
            x1={Y_LABEL_W}
            y1={TOP_PAD + drawH}
            x2={width}
            y2={TOP_PAD + drawH}
            stroke="var(--border)"
            strokeWidth={1}
          />

          {/* Series */}
          {chartW > 0 &&
            series.map((s) => {
              const d = buildLinePath(s.data, chartW, drawH, domain);
              if (!d) return null;
              return (
                <path
                  key={s.key}
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  transform={`translate(${Y_LABEL_W},0)`}
                />
              );
            })}

          {/* Crosshair */}
          {tooltip !== null && timestamps.length > 1 && chartW > 0 && (
            <line
              x1={
                Y_LABEL_W + (tooltip.index / (timestamps.length - 1)) * chartW
              }
              y1={TOP_PAD}
              x2={
                Y_LABEL_W + (tooltip.index / (timestamps.length - 1)) * chartW
              }
              y2={TOP_PAD + drawH}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.4}
              strokeWidth={1}
              strokeDasharray="3 2"
            />
          )}

          {/* X labels */}
          {xTickIndices.map((i, li) => {
            const isFirst = li === 0;
            const isLast = li === xTickIndices.length - 1;
            const x =
              Y_LABEL_W + (i / Math.max(1, timestamps.length - 1)) * chartW;
            return (
              <text
                key={i}
                x={x}
                y={svgH - 4}
                fontSize={10}
                textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
                fill="var(--muted-foreground)"
              >
                {timestamps[i] ? formatTimestamp(timestamps[i], rangeMs) : ""}
              </text>
            );
          })}
        </svg>
      )}

      {/* Tooltip */}
      {tooltip !== null && timestamps[tooltip.index] && (
        <div
          className="pointer-events-none absolute z-10 border border-border bg-popover px-2 py-1.5 text-xs shadow-md"
          style={{
            left: tooltip.x > width / 2 ? tooltip.x - 8 : tooltip.x + 8,
            top: 28,
            transform: tooltip.x > width / 2 ? "translateX(-100%)" : undefined,
          }}
        >
          <div className="mb-1 font-medium text-muted-foreground">
            {formatTimestamp(timestamps[tooltip.index], rangeMs)}
          </div>
          {series.map((s) => {
            const v = s.data[tooltip.index];
            return (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-3 rounded-full shrink-0"
                  style={{ background: s.color }}
                />
                <span className="text-muted-foreground">{s.label}:</span>
                <span className="font-medium">
                  {v != null ? yFormatter(v) : "--"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
