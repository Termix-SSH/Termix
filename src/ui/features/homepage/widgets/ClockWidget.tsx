import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import type { ClockConfig, WidgetComponentProps } from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

function ClockWidget({ widget, config }: WidgetComponentProps<ClockConfig>) {
  const { timezone, showSeconds, format } = config;
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" } : {}),
    hour12: format === "12h",
    ...(timezone ? { timeZone: timezone } : {}),
  };

  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(timezone ? { timeZone: timezone } : {}),
  };

  const timeStr = now.toLocaleTimeString(undefined, opts);
  const dateStr = now.toLocaleDateString(undefined, dateOpts);

  return (
    <div className="flex flex-col w-full h-full overflow-hidden select-none">
      <WidgetTitle title={widget.title} icon={<Clock size={11} />} />
      <div className="flex flex-col items-center justify-center flex-1 gap-1 p-3 overflow-auto">
        <span className="text-2xl font-bold tabular-nums text-accent-brand">
          {timeStr}
        </span>
        <span className="text-xs text-muted-foreground">{dateStr}</span>
        {timezone && (
          <span className="text-[10px] text-muted-foreground/60">
            {timezone}
          </span>
        )}
      </div>
    </div>
  );
}

registerWidget<ClockConfig>({
  id: "clock",
  name: "Clock",
  description: "A live clock with configurable timezone",
  category: "info",
  icon: <Clock size={14} />,
  defaultConfig: { showSeconds: true, format: "24h" },
  defaultSize: { w: GRID_SIZE * 8, h: GRID_SIZE * 5 },
  minSize: { w: GRID_SIZE * 2, h: GRID_SIZE * 2 },
  component: ClockWidget,
});

export { ClockWidget };
