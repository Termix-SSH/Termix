import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Switch } from "@/components/switch";
import type {
  WeatherConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function WeatherEditForm({
  config,
  onChange,
}: WidgetEditFormProps<WeatherConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.location")}
        </label>
        <Input
          value={config.location}
          onChange={(e) => onChange({ ...config, location: e.target.value })}
          placeholder="New York, London, Tokyo..."
          className="h-8 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.temperatureUnit")}
        </label>
        <div className="flex gap-0 border border-border">
          {(["C", "F"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => onChange({ ...config, unit: u })}
              className={`flex-1 h-8 text-sm transition-colors ${
                config.unit === u
                  ? "bg-accent-brand text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              °{u}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">
          {t("homepage.showForecast")}
        </label>
        <Switch
          checked={config.showForecast}
          onCheckedChange={(v) => onChange({ ...config, showForecast: v })}
        />
      </div>
    </div>
  );
}
