import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Compact search row shared by manager cards. Optional `extra` renders to the
 * right (filters, action buttons) and `count` shows a result tally.
 */
export function ManagerSearch({
  value,
  onChange,
  placeholder,
  count,
  extra,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  count?: number;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t("hostMetrics.managers.filter")}
          className="h-7 w-full border border-border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {count != null && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      {extra}
    </div>
  );
}
