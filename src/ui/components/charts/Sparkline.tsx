import { useId } from "react";
import { cn } from "@/lib/utils";
import { sparklineGeometry, SPARKLINE_VIEW_W } from "./geometry";

export interface SparklineProps {
  /** Series of values, oldest first. */
  data: Array<number | null | undefined>;
  /**
   * Fixed value domain [min, max]. When omitted the domain is derived from the
   * data. Providing a stable domain (e.g. [0, 100] for percentages) avoids the
   * jittery rescaling the old sparkline had.
   */
  domain?: [number, number];
  className?: string;
  /** Tailwind text-color class for the line/fill (uses currentColor). */
  colorClassName?: string;
  /** Show a dot on the last point. */
  showLastDot?: boolean;
  /** Internal coordinate height; the SVG scales to its container. */
  height?: number;
}

/**
 * Compact area + line chart. Uses a non-scaling stroke + a stable value domain
 * so the line stays crisp and readable regardless of container size.
 */
export function Sparkline({
  data,
  domain,
  className,
  colorClassName = "text-accent-brand",
  showLastDot = true,
  height = 56,
}: SparklineProps) {
  const gradientId = useId();
  const { hasData, coords, linePath, areaPath } = sparklineGeometry(
    data,
    height,
    domain,
  );
  const last = coords[coords.length - 1];

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden border border-border/50 bg-muted/20",
        colorClassName,
        className,
      )}
      style={{ height }}
    >
      {hasData && (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${SPARKLINE_VIEW_W} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="opacity-80"
          />
          {showLastDot && last && (
            <circle
              cx={last[0]}
              cy={last[1]}
              r={2.5}
              fill="currentColor"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
    </div>
  );
}
