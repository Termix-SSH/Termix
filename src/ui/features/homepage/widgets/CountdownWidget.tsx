import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  CountdownConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

function getAccentColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145"
  );
}

function decompose(ms: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return { days, hours, minutes, seconds };
}

function UnitBlock({ value, label }: { value: number; label: string }) {
  const accent = getAccentColor();
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className="text-2xl font-bold tabular-nums leading-none"
        style={{ color: accent }}
      >
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function CountdownWidget({
  widget,
  config,
}: WidgetComponentProps<CountdownConfig>) {
  const { t } = useTranslation();
  const { targetDate, label, showDays, showHours } = config;
  const [remaining, setRemaining] = useState(0);
  const [past, setPast] = useState(false);

  useEffect(() => {
    const update = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining(0);
        setPast(true);
      } else {
        setRemaining(diff);
        setPast(false);
      }
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [targetDate]);

  const titleBar = (
    <WidgetTitle title={widget.title} icon={<Timer size={11} />} />
  );

  if (!targetDate) {
    return (
      <div className="flex flex-col w-full h-full overflow-hidden">
        {titleBar}
        <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground">
          {t("homepage.countdownNoDate")}
        </div>
      </div>
    );
  }

  if (past) {
    return (
      <div className="flex flex-col w-full h-full overflow-hidden">
        {titleBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-1">
          <Timer size={16} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {t("homepage.countdownPast")}
          </span>
          {label && (
            <span className="text-[10px] text-muted-foreground/60">
              {label}
            </span>
          )}
        </div>
      </div>
    );
  }

  const { days, hours, minutes, seconds } = decompose(remaining);

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      {titleBar}
      <div className="flex flex-col items-center justify-center flex-1 gap-2 p-2">
        {label && (
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
        )}
        <div className="flex items-center gap-3 flex-wrap justify-center">
          {showDays && (
            <UnitBlock value={days} label={t("homepage.countdownDays")} />
          )}
          {showHours && (
            <UnitBlock value={hours} label={t("homepage.countdownHours")} />
          )}
          <UnitBlock value={minutes} label={t("homepage.countdownMinutes")} />
          <UnitBlock value={seconds} label={t("homepage.countdownSeconds")} />
        </div>
      </div>
    </div>
  );
}

registerWidget<CountdownConfig>({
  id: "countdown",
  name: "Countdown",
  description: "Counts down to a target date and time",
  category: "info",
  icon: <Timer size={14} />,
  defaultConfig: { targetDate: "", label: "", showDays: true, showHours: true },
  defaultSize: { w: GRID_SIZE * 8, h: GRID_SIZE * 5 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: CountdownWidget,
});

export { CountdownWidget };
