import { useEffect, useState, useRef } from "react";
import { Clock4 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  TermixUptimeConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getUptime } from "@/api/dashboard-api";
import { WidgetTitle } from "./WidgetTitle";

function formatUptime(seconds: number): {
  days: number;
  hours: number;
  minutes: number;
  secs: number;
} {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return { days, hours, minutes, secs };
}

function TermixUptimeWidget({
  widget,
  config,
}: WidgetComponentProps<TermixUptimeConfig>) {
  const { t } = useTranslation();
  const { showDetailed } = config;
  const [seconds, setSeconds] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const baseRef = useRef<number | null>(null);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    getUptime()
      .then((info) => {
        baseRef.current = info.uptimeSeconds;
        startRef.current = Date.now();
        setSeconds(info.uptimeSeconds);
      })
      .catch(() => setError(true));

    const iv = setInterval(() => {
      if (baseRef.current !== null) {
        const elapsed = (Date.now() - startRef.current) / 1000;
        setSeconds(Math.floor(baseRef.current + elapsed));
      }
    }, 1000);

    return () => clearInterval(iv);
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.uptimeUnavailable")}
      </div>
    );
  }

  if (seconds === null) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.loading")}
      </div>
    );
  }

  const { days, hours, minutes, secs } = formatUptime(seconds);
  const accent =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145";

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Clock4 size={11} />} />
      <div className="flex flex-col items-center justify-center flex-1 gap-1 p-2">
        <Clock4 size={14} className="text-muted-foreground" />
        <div className="flex items-baseline gap-1 flex-wrap justify-center">
          {days > 0 && (
            <span
              className="text-xl font-bold tabular-nums"
              style={{ color: accent }}
            >
              {days}
              <span className="text-xs font-normal text-muted-foreground ml-0.5">
                d
              </span>
            </span>
          )}
          <span
            className="text-xl font-bold tabular-nums"
            style={{ color: accent }}
          >
            {String(hours).padStart(2, "0")}
            <span className="text-xs font-normal text-muted-foreground ml-0.5">
              h
            </span>
          </span>
          <span
            className="text-xl font-bold tabular-nums"
            style={{ color: accent }}
          >
            {String(minutes).padStart(2, "0")}
            <span className="text-xs font-normal text-muted-foreground ml-0.5">
              m
            </span>
          </span>
          {showDetailed && (
            <span
              className="text-xl font-bold tabular-nums"
              style={{ color: accent }}
            >
              {String(secs).padStart(2, "0")}
              <span className="text-xs font-normal text-muted-foreground ml-0.5">
                s
              </span>
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {t("homepage.uptimeLabel")}
        </span>
      </div>
    </div>
  );
}

registerWidget<TermixUptimeConfig>({
  id: "termix_uptime",
  name: "Termix Uptime",
  description: "Shows how long the Termix server has been running",
  category: "system",
  icon: <Clock4 size={14} />,
  defaultConfig: { showDetailed: false },
  defaultSize: { w: GRID_SIZE * 8, h: GRID_SIZE * 4 },
  minSize: { w: GRID_SIZE * 3, h: GRID_SIZE * 2 },
  component: TermixUptimeWidget,
});

export { TermixUptimeWidget };
