import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InfoItem {
  label: ReactNode;
  value: ReactNode;
  /** Monospace value, for ids, paths and addresses. */
  mono?: boolean;
}

/** Label and value pairs in two aligned columns. Empty values are skipped. */
export function InfoGrid({
  items,
  className,
}: {
  items: InfoItem[];
  className?: string;
}) {
  const shown = items.filter(
    (item) =>
      item.value !== null && item.value !== undefined && item.value !== "",
  );
  if (shown.length === 0) return null;
  return (
    <dl
      className={cn(
        "grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs",
        className,
      )}
    >
      {shown.map((item, index) => (
        <div key={index} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className={cn("min-w-0 break-words", item.mono && "font-mono")}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
