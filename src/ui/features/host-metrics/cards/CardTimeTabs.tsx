import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type HistoryTab = "live" | "1h" | "6h" | "24h" | "7d";

const TABS: HistoryTab[] = ["live", "1h", "6h", "24h", "7d"];

export function CardTimeTabs({
  value,
  onChange,
}: {
  value: HistoryTab;
  onChange: (tab: HistoryTab) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-0.5">
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={cn(
            "px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest transition-colors border",
            value === tab
              ? "border-accent-brand bg-accent-brand/10 text-accent-brand"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab === "live" ? t("hostMetrics.tabLive") : tab}
        </button>
      ))}
    </div>
  );
}
