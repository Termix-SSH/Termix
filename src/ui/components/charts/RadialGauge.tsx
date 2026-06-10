import { cn } from "@/lib/utils";
import { gaugeArc } from "./geometry";

export interface RadialGaugeProps {
  /** 0..100 percentage, or null for "no data". */
  value: number | null;
  /** Large centered text (defaults to the percentage). */
  label?: string;
  /** Small caption under the value. */
  caption?: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Tailwind text-color class for the value arc. */
  colorClassName?: string;
}

/**
 * A 270-degree radial gauge with a big centered readout. Auto-themes via
 * currentColor; the track uses the muted token.
 */
export function RadialGauge({
  value,
  label,
  caption,
  size = 120,
  strokeWidth = 9,
  className,
  colorClassName = "text-accent-brand",
}: RadialGaugeProps) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // 270-degree sweep starting at the bottom-left (135deg), going clockwise.
  const startAngle = 135;
  const { trackLen, valueLen, circumference } = gaugeArc(value, radius, 270);

  const display = label ?? (value === null ? "N/A" : `${Math.round(pct)}%`);

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={colorClassName}
        style={{ transform: `rotate(${startAngle}deg)` }}
        aria-hidden="true"
      >
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted"
          strokeDasharray={`${trackLen} ${circumference}`}
          strokeLinecap="round"
        />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={`${valueLen} ${circumference}`}
          strokeLinecap="round"
          className="transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cn(
            "text-xl font-bold leading-none md:text-2xl",
            value === null ? "text-muted-foreground" : colorClassName,
          )}
        >
          {display}
        </span>
        {caption && (
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
