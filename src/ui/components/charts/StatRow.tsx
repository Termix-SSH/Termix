import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Dense key/value row used across metric and manager cards. */
export function StatRow({
  label,
  value,
  mono = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 py-1.5 text-xs",
        className,
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right font-semibold",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** A compact stacked stat: small uppercase caption over a bold value. */
export function MiniStat({
  caption,
  value,
  valueClassName,
  className,
}: {
  caption: ReactNode;
  value: ReactNode;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {caption}
      </span>
      <span className={cn("text-sm font-bold leading-none", valueClassName)}>
        {value}
      </span>
    </div>
  );
}
