import { cn } from "@/lib/utils";
import { usageBarColor, usageColor } from "@/lib/usage-color";

/** A usage bar on the shared color ramp. */
export function Meter({
  percent,
  className,
}: {
  percent: number | null;
  className?: string;
}) {
  const clamped = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden bg-muted", className)}>
      <div
        className={cn("motion-meter h-full", usageBarColor(percent))}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/**
 * A meter with its readout. Pass `label` for the stacked card form; leave it off
 * for the bare form a table cell wants.
 */
export function UsagePair({
  label,
  percent,
  detail,
}: {
  label?: string;
  percent: number;
  detail?: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex min-w-0 items-center gap-2">
      {label && (
        <span className="w-10 shrink-0 text-[10px] uppercase text-muted-foreground">
          {label}
        </span>
      )}
      <Meter percent={clamped} className="flex-1" />
      <span
        className={cn(
          "shrink-0 text-right text-[11px] tabular-nums",
          detail ? "text-muted-foreground" : usageColor(clamped),
        )}
      >
        {detail ?? `${Math.round(clamped)}%`}
      </span>
    </div>
  );
}
