import { cn } from "@/lib/utils";

export interface BarSeriesItem {
  label: string;
  /** 0..max value driving the bar width. */
  value: number;
  /** Optional right-aligned value text (defaults to value). */
  valueLabel?: string;
}

export interface BarSeriesProps {
  items: BarSeriesItem[];
  /** Domain max; defaults to the largest value (min 1). */
  max?: number;
  className?: string;
  colorClassName?: string;
}

/** Compact horizontal bar list with a label, a track, and a value. */
export function BarSeries({
  items,
  max,
  className,
  colorClassName = "bg-accent-brand",
}: BarSeriesProps) {
  const domainMax = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {items.map((item, i) => {
        const pct = Math.min(100, Math.max(0, (item.value / domainMax) * 100));
        return (
          <div key={`${item.label}-${i}`} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">
                {item.label}
              </span>
              <span className="shrink-0 font-mono text-[11px] font-semibold">
                {item.valueLabel ?? item.value}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden bg-muted">
              <div
                className={cn(
                  "h-full transition-all duration-500",
                  colorClassName,
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
