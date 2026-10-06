import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface TabStripItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Small count after the label. */
  count?: number;
}

/** Scrollable underline tabs with overflow arrows. */
export function TabStrip({
  tabs,
  activeTab,
  onTabChange,
  isActive,
  variant = "primary",
  trailing,
  className,
}: {
  tabs: TabStripItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  isActive?: (id: string) => boolean;
  variant?: "primary" | "secondary";
  /** Sits after the tabs, outside the scroll area. */
  trailing?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const [scroll, setScroll] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setScroll({
        left: el.scrollLeft > 1,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    el.addEventListener("scroll", update);
    update();
    return () => {
      observer?.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [tabs]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const renderTab = (tab: TabStripItem) => {
    const active = isActive ? isActive(tab.id) : activeTab === tab.id;
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => onTabChange(tab.id)}
        className={`flex items-center gap-1.5 px-3 ${
          variant === "secondary" ? "py-1.5 text-[11px]" : "py-2 text-xs"
        } font-medium whitespace-nowrap border-b-2 transition-colors shrink-0 ${
          active
            ? "border-accent-brand text-accent-brand"
            : "border-transparent text-muted-foreground hover:text-foreground"
        }`}
      >
        {tab.icon}
        {tab.label}
        {tab.count !== undefined && (
          <span className="text-[10px] tabular-nums opacity-60">
            {tab.count}
          </span>
        )}
      </button>
    );
  };

  const overflow = scroll.left || scroll.right;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        variant === "secondary" && "border-t border-border bg-card",
        className,
      )}
    >
      {overflow && (
        <button
          type="button"
          aria-label={t("common.scrollTabsLeft")}
          title={t("common.scrollTabsLeft")}
          disabled={!scroll.left}
          className="shrink-0 p-1 disabled:opacity-30"
          onClick={() =>
            ref.current?.scrollBy({
              left: -ref.current.clientWidth * 0.75,
              behavior: "smooth",
            })
          }
        >
          <ChevronLeft className="size-4" />
        </button>
      )}
      <div ref={ref} className="min-w-0 flex-1 overflow-x-auto scrollbar-none">
        <div className="flex min-w-max">{tabs.map(renderTab)}</div>
      </div>
      {overflow && (
        <button
          type="button"
          aria-label={t("common.scrollTabsRight")}
          title={t("common.scrollTabsRight")}
          disabled={!scroll.right}
          className="shrink-0 p-1 disabled:opacity-30"
          onClick={() =>
            ref.current?.scrollBy({
              left: ref.current.clientWidth * 0.75,
              behavior: "smooth",
            })
          }
        >
          <ChevronRight className="size-4" />
        </button>
      )}
      {trailing && (
        <div className="flex shrink-0 items-center gap-1 px-1">{trailing}</div>
      )}
    </div>
  );
}
