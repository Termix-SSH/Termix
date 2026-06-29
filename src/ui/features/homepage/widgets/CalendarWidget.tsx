import { useState, useEffect } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  CalendarConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

function getMonthData(year: number, month: number, startOnMonday: boolean) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = startOnMonday ? (firstDay === 0 ? 6 : firstDay - 1) : firstDay;
  return { daysInMonth, offset };
}

function CalendarWidget({
  widget,
  config,
}: WidgetComponentProps<CalendarConfig>) {
  const { t } = useTranslation();
  const { startOnMonday } = config;
  const [now, setNow] = useState(new Date());
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(iv);
  }, []);

  const { daysInMonth, offset } = getMonthData(
    viewYear,
    viewMonth,
    startOnMonday,
  );
  const today = now;
  const isCurrentMonth =
    viewYear === today.getFullYear() && viewMonth === today.getMonth();

  const dayNames = startOnMonday
    ? [
        t("homepage.calMon"),
        t("homepage.calTue"),
        t("homepage.calWed"),
        t("homepage.calThu"),
        t("homepage.calFri"),
        t("homepage.calSat"),
        t("homepage.calSun"),
      ]
    : [
        t("homepage.calSun"),
        t("homepage.calMon"),
        t("homepage.calTue"),
        t("homepage.calWed"),
        t("homepage.calThu"),
        t("homepage.calFri"),
        t("homepage.calSat"),
      ];

  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(viewYear, viewMonth, 1));

  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
  };

  const accent =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145";

  return (
    <div className="flex flex-col w-full h-full overflow-hidden select-none">
      <WidgetTitle title={widget.title} icon={<CalendarDays size={11} />} />
      <div className="flex flex-col flex-1 p-2 gap-1 overflow-hidden">
        <div className="flex items-center justify-between shrink-0">
          <button
            onClick={prevMonth}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={12} />
          </button>
          <span className="text-[10px] font-semibold text-foreground">
            {monthLabel}
          </span>
          <button
            onClick={nextMonth}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight size={12} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0 shrink-0">
          {dayNames.map((d) => (
            <div
              key={d}
              className="text-center text-[8px] font-semibold text-muted-foreground/70 uppercase py-0.5"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0 flex-1 content-start">
          {cells.map((day, i) => {
            if (day === null) return <div key={`e-${i}`} />;
            const isToday = isCurrentMonth && day === today.getDate();
            return (
              <div
                key={`d-${day}`}
                className="flex items-center justify-center aspect-square"
              >
                <span
                  className="text-[9px] font-medium w-5 h-5 flex items-center justify-center rounded-full"
                  style={
                    isToday
                      ? { background: accent, color: "#fff" }
                      : { color: "var(--text-primary, currentColor)" }
                  }
                >
                  {day}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

registerWidget<CalendarConfig>({
  id: "calendar",
  name: "Calendar",
  description: "A month calendar with today highlighted",
  category: "info",
  icon: <CalendarDays size={14} />,
  defaultConfig: { startOnMonday: true },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 9 },
  minSize: { w: GRID_SIZE * 7, h: GRID_SIZE * 7 },
  component: CalendarWidget,
});

export { CalendarWidget };
