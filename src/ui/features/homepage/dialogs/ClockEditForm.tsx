import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Switch } from "@/components/switch";
import type { ClockConfig, WidgetEditFormProps } from "@/types/homepage-types";
import { validateClockTimezone } from "../clock-timezone";

export function ClockEditForm({
  config,
  onChange,
}: WidgetEditFormProps<ClockConfig>) {
  const { t } = useTranslation();

  const invalidTimezone = !validateClockTimezone(config.timezone).valid;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.timezone")}
        </label>
        <Input
          value={config.timezone ?? ""}
          onChange={(e) =>
            onChange({ ...config, timezone: e.target.value || undefined })
          }
          placeholder="America/New_York (leave blank for local)"
          aria-invalid={invalidTimezone}
          className={
            invalidTimezone ? "h-8 text-sm border-destructive" : "h-8 text-sm"
          }
        />
        {invalidTimezone && (
          <p className="text-[10px] text-destructive">
            {t("homepage.invalidTimezone")}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">
          {t("homepage.showSeconds")}
        </label>
        <Switch
          checked={config.showSeconds}
          onCheckedChange={(v) => onChange({ ...config, showSeconds: v })}
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">
          {t("homepage.format12h")}
        </label>
        <Switch
          checked={config.format === "12h"}
          onCheckedChange={(v) =>
            onChange({ ...config, format: v ? "12h" : "24h" })
          }
        />
      </div>
    </div>
  );
}
