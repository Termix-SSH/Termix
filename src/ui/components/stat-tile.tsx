import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Meter } from "@/components/meter";
import { TileFrame } from "@/components/tile-grid/TileFrame";

const VALUE_TONE = {
  default: "",
  ok: "text-green-500",
  warn: "text-warning",
  bad: "text-destructive",
} as const;

/**
 * One number in the tile look: the small title row, a big value, then an
 * optional usage bar and a hint line. Put several in a TileWall for a strip.
 */
export function StatTile({
  label,
  icon,
  value,
  unit,
  percent,
  hint,
  tone = "default",
  actions,
  onClick,
  children,
  className,
}: {
  label: ReactNode;
  icon?: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  /** Draws a usage bar under the value. */
  percent?: number | null;
  hint?: ReactNode;
  tone?: keyof typeof VALUE_TONE;
  actions?: ReactNode;
  onClick?: () => void;
  /** Extra lines under the hint. */
  children?: ReactNode;
  className?: string;
}) {
  const body = (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-baseline gap-1">
        <span
          className={cn(
            "truncate text-2xl font-bold tabular-nums leading-none",
            VALUE_TONE[tone],
          )}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {percent !== undefined && <Meter percent={percent} />}
      {hint && (
        <span className="truncate text-[11px] text-muted-foreground">
          {hint}
        </span>
      )}
      {children}
    </div>
  );
  return (
    <TileFrame
      title={label}
      icon={icon}
      actions={actions}
      className={className}
      bodyClassName="overflow-hidden"
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="text-left transition-colors hover:bg-muted/40"
        >
          {body}
        </button>
      ) : (
        body
      )}
    </TileFrame>
  );
}
