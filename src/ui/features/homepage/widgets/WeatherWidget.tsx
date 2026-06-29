import { useEffect, useState } from "react";
import {
  Cloud,
  CloudRain,
  Sun,
  CloudSnow,
  Wind,
  Thermometer,
} from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import type {
  WeatherConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

interface WttrCurrent {
  temp_C: string;
  FeelsLikeC: string;
  weatherDesc: { value: string }[];
  weatherCode: string;
}

interface WttrDay {
  mintempC: string;
  maxtempC: string;
  hourly: { weatherDesc: { value: string }[]; weatherCode: string }[];
}

interface WttrResponse {
  nearest_area: {
    areaName: { value: string }[];
    country: { value: string }[];
  }[];
  current_condition: WttrCurrent[];
  weather: WttrDay[];
}

function weatherIcon(code: string, size = 20) {
  const n = Number(code);
  if (n === 113) return <Sun size={size} className="text-yellow-400" />;
  if (n <= 119) return <Cloud size={size} className="text-gray-400" />;
  if (n <= 143) return <Cloud size={size} className="text-gray-400" />;
  if (n <= 266) return <CloudRain size={size} className="text-blue-400" />;
  if (n <= 335) return <CloudSnow size={size} className="text-blue-200" />;
  if (n <= 389) return <CloudRain size={size} className="text-blue-500" />;
  return <Wind size={size} className="text-muted-foreground" />;
}

function celsiusToF(c: number) {
  return Math.round((c * 9) / 5 + 32);
}

function WeatherWidget({
  widget,
  config,
}: WidgetComponentProps<WeatherConfig>) {
  const { location, unit, showForecast } = config;
  const [data, setData] = useState<WttrResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        setError(false);
        const res = await fetch(
          `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
        );
        if (!res.ok) throw new Error("bad response");
        const json: WttrResponse = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    fetchWeather();
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [location]);

  if (!location) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground/60 p-3 text-center">
        Configure a location in widget settings
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-destructive/70 p-3 text-center">
        Could not load weather for "{location}"
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground/50">
        Loading...
      </div>
    );
  }

  const current = data.current_condition[0];
  const area = data.nearest_area[0];
  const cityName = area?.areaName[0]?.value ?? location;
  const tempC = Number(current.temp_C);
  const feelsC = Number(current.FeelsLikeC);
  const displayTemp = unit === "F" ? `${celsiusToF(tempC)}°F` : `${tempC}°C`;
  const displayFeels = unit === "F" ? `${celsiusToF(feelsC)}°F` : `${feelsC}°C`;
  const desc = current.weatherDesc[0]?.value ?? "";
  const code = current.weatherCode;

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Sun size={11} />} />
      <div className="flex flex-col flex-1 p-3 gap-2 overflow-auto">
        {/* Current conditions */}
        <div className="flex items-center gap-3 flex-1 min-h-0">
          <div className="shrink-0">{weatherIcon(code, 32)}</div>
          <div className="flex flex-col min-w-0">
            <span className="text-2xl font-bold text-foreground leading-none">
              {displayTemp}
            </span>
            <span className="text-[10px] text-muted-foreground truncate">
              {desc}
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              Feels like {displayFeels}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Thermometer
            size={10}
            className="text-muted-foreground/60 shrink-0"
          />
          <span className="text-[11px] font-semibold text-foreground truncate">
            {cityName}
          </span>
        </div>

        {/* 3-day forecast */}
        {showForecast && data.weather.length >= 3 && (
          <div className="flex gap-1 border-t border-border pt-2 mt-auto shrink-0">
            {data.weather.slice(0, 3).map((day, i) => {
              const hourly = day.hourly[4] ?? day.hourly[0];
              const minC = Number(day.mintempC);
              const maxC = Number(day.maxtempC);
              const lo = unit === "F" ? `${celsiusToF(minC)}°` : `${minC}°`;
              const hi = unit === "F" ? `${celsiusToF(maxC)}°` : `${maxC}°`;
              const dayLabel = i === 0 ? "Today" : i === 1 ? "Tmrw" : "+2";
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center gap-0.5"
                >
                  <span className="text-[9px] text-muted-foreground/70">
                    {dayLabel}
                  </span>
                  {weatherIcon(hourly?.weatherCode ?? "113", 12)}
                  <span className="text-[9px] text-foreground">{hi}</span>
                  <span className="text-[9px] text-muted-foreground/60">
                    {lo}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

registerWidget<WeatherConfig>({
  id: "weather",
  name: "Weather",
  description: "Live weather for any location",
  category: "info",
  icon: <Sun size={14} />,
  defaultConfig: { location: "", unit: "C", showForecast: true },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 7 },
  minSize: { w: GRID_SIZE * 2, h: GRID_SIZE * 2 },
  component: WeatherWidget,
});

export { WeatherWidget };
