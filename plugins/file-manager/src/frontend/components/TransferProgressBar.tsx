import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

export function TransferProgressBar({
  value,
  label,
  stalled = false,
}: {
  value?: number;
  label: string;
  stalled?: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, value ?? 0));
  const indeterminate = value === undefined;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-busy={indeterminate}
      data-stalled={stalled || undefined}
      className="transfer-progress-track"
    >
      <div
        className={cn(
          "transfer-progress-fill",
          indeterminate && "transfer-progress-indeterminate",
          stalled && "transfer-progress-stalled",
        )}
        style={
          indeterminate
            ? undefined
            : ({ "--transfer-progress": clamped / 100 } as CSSProperties)
        }
      />
    </div>
  );
}
