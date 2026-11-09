import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** A spinner with a short line, for a view waiting on its first load. */
export function LoadingState({
  label,
  compact = false,
  className,
}: {
  label?: string;
  /** One inline line instead of the centered block. */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const text = label ?? t("common.loading");
  if (compact) {
    return (
      <div
        role="status"
        data-slot="loading-state"
        className={cn(
          "flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="size-3 animate-spin" />
        {text}
      </div>
    );
  }
  return (
    <div
      role="status"
      data-slot="loading-state"
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-xs text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin opacity-60" />
      {text}
    </div>
  );
}
