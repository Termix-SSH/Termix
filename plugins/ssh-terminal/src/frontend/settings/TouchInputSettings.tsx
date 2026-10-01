import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  normalizeTouchInputSettings,
  TOUCH_INPUT_DEFAULTS,
  TOUCH_INPUT_NUMERIC_BOUNDS,
  type TouchInputNumericKey,
  type TouchInputSettings as TouchInputValues,
} from "../../shared/touch-input-settings";
import { Button, Input, SettingRow, Switch } from "@termix/plugin-sdk/ui";
import {
  useTranslation,
  type SettingsComponentProps,
} from "@termix/plugin-sdk/frontend";
import { cacheTouchInputSettings } from "../terminal/touch-input-settings-store";

const fields: Array<{
  key: TouchInputNumericKey;
  label: string;
  unit: string;
}> = [
  { key: "dragThresholdPx", label: "dragThreshold", unit: "px" },
  { key: "maxWheelDeltaPx", label: "maxWheelDelta", unit: "px" },
  {
    key: "momentumSampleWindowMs",
    label: "momentumSampleWindow",
    unit: "ms",
  },
  {
    key: "releaseGracePeriodMs",
    label: "releaseGracePeriod",
    unit: "ms",
  },
  {
    key: "minimumVelocityPxPerMs",
    label: "minimumVelocity",
    unit: "px/ms",
  },
  {
    key: "maximumVelocityPxPerMs",
    label: "maximumVelocity",
    unit: "px/ms",
  },
  { key: "maximumDurationMs", label: "maximumDuration", unit: "ms" },
  { key: "maximumTravelPx", label: "maximumTravel", unit: "px" },
  { key: "decayTimeMs", label: "decayTime", unit: "ms" },
  { key: "pixelsPerTick", label: "pixelsPerTick", unit: "px" },
  {
    key: "maximumFrameIntervalMs",
    label: "maximumFrameInterval",
    unit: "ms",
  },
  {
    key: "maximumTicksPerFrame",
    label: "maximumTicksPerFrame",
    unit: "",
  },
];

/**
 * Touch scrolling tuning for terminals on touch screens, stored as one
 * object in the "touchInput" admin setting.
 */
export function TouchInputSettings({
  values,
  setValue,
}: SettingsComponentProps) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const settings = normalizeTouchInputSettings(values.touchInput);
  const setSettings = (next: TouchInputValues) => {
    const normalized = normalizeTouchInputSettings(next);
    cacheTouchInputSettings(normalized);
    setValue("touchInput", normalized);
  };

  return (
    <div className="flex flex-col gap-0">
      <SettingRow
        label={t("touchInput.enabled")}
        description={t("touchInput.enabledDesc")}
      >
        <Switch
          checked={settings.enabled}
          onCheckedChange={(enabled) => setSettings({ ...settings, enabled })}
        />
      </SettingRow>
      <SettingRow
        label={t("touchInput.momentumEnabled")}
        description={t("touchInput.momentumEnabledDesc")}
      >
        <Switch
          checked={settings.momentumEnabled}
          disabled={!settings.enabled}
          onCheckedChange={(momentumEnabled) =>
            setSettings({ ...settings, momentumEnabled })
          }
        />
      </SettingRow>

      <button
        type="button"
        className="flex items-center gap-2 py-3 text-left text-xs font-semibold text-foreground"
        onClick={() => setAdvancedOpen((value) => !value)}
      >
        <ChevronDown
          className={`size-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
        />
        {t("touchInput.advanced")}
      </button>
      {advancedOpen && (
        <div className="grid grid-cols-1 gap-3 pb-3">
          {fields.map(({ key, label, unit }) => {
            const bounds = TOUCH_INPUT_NUMERIC_BOUNDS[key];
            return (
              <label key={key} className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">
                  {t(`touchInput.${label}`)}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={t(`touchInput.${label}`)}
                    type="number"
                    min={bounds.min}
                    max={bounds.max}
                    step={bounds.step}
                    value={settings[key]}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        [key]: Number(event.target.value),
                      })
                    }
                    className="h-8 text-xs"
                  />
                  {unit && (
                    <span className="w-10 text-muted-foreground">{unit}</span>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
      <div className="flex gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSettings({ ...TOUCH_INPUT_DEFAULTS })}
        >
          {t("touchInput.resetDefaults")}
        </Button>
      </div>
    </div>
  );
}
