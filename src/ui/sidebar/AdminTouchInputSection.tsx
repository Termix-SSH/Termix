import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Hand } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { SettingRow } from "@/components/section-card";
import type {
  TouchInputNumericKey,
  TouchInputSettings,
} from "@/types/touch-input-settings";
import { TOUCH_INPUT_NUMERIC_BOUNDS } from "@/types/touch-input-settings";
import { AccordionSection, AdminToggle } from "./AdminSettingsShared";

const fields: Array<{
  key: TouchInputNumericKey;
  label: string;
  unit: string;
}> = [
  { key: "dragThresholdPx", label: "touchDragThreshold", unit: "px" },
  { key: "maxWheelDeltaPx", label: "touchMaxWheelDelta", unit: "px" },
  {
    key: "momentumSampleWindowMs",
    label: "touchMomentumSampleWindow",
    unit: "ms",
  },
  {
    key: "releaseGracePeriodMs",
    label: "touchReleaseGracePeriod",
    unit: "ms",
  },
  {
    key: "minimumVelocityPxPerMs",
    label: "touchMinimumVelocity",
    unit: "px/ms",
  },
  {
    key: "maximumVelocityPxPerMs",
    label: "touchMaximumVelocity",
    unit: "px/ms",
  },
  { key: "maximumDurationMs", label: "touchMaximumDuration", unit: "ms" },
  { key: "maximumTravelPx", label: "touchMaximumTravel", unit: "px" },
  { key: "decayTimeMs", label: "touchDecayTime", unit: "ms" },
  { key: "pixelsPerTick", label: "touchPixelsPerTick", unit: "px" },
  {
    key: "maximumFrameIntervalMs",
    label: "touchMaximumFrameInterval",
    unit: "ms",
  },
  {
    key: "maximumTicksPerFrame",
    label: "touchMaximumTicksPerFrame",
    unit: "",
  },
];

export function AdminTouchInputSection({
  open,
  onToggle,
  settings,
  setSettings,
  onSave,
  onReset,
}: {
  open: boolean;
  onToggle: () => void;
  settings: TouchInputSettings;
  setSettings: (settings: TouchInputSettings) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <AccordionSection
      label={t("admin.sectionTouchInput")}
      icon={<Hand className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col gap-0 pt-2">
        <SettingRow
          label={t("admin.touchEnabled")}
          description={t("admin.touchEnabledDesc")}
        >
          <AdminToggle
            on={settings.enabled}
            onToggle={() =>
              setSettings({ ...settings, enabled: !settings.enabled })
            }
          />
        </SettingRow>
        <SettingRow
          label={t("admin.touchMomentumEnabled")}
          description={t("admin.touchMomentumEnabledDesc")}
        >
          <AdminToggle
            on={settings.momentumEnabled}
            onToggle={() =>
              setSettings({
                ...settings,
                momentumEnabled: !settings.momentumEnabled,
              })
            }
            disabled={!settings.enabled}
          />
        </SettingRow>

        <button
          type="button"
          className="mt-2 flex items-center gap-2 border-t border-border py-3 text-left text-xs font-semibold text-foreground"
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
          />
          {t("admin.touchAdvanced")}
        </button>
        {advancedOpen && (
          <div className="grid grid-cols-1 gap-3 pb-3 sm:grid-cols-2">
            {fields.map(({ key, label, unit }) => {
              const bounds = TOUCH_INPUT_NUMERIC_BOUNDS[key];
              return (
                <label key={key} className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-foreground">
                    {t(`admin.${label}`)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={t(`admin.${label}`)}
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
          <Button size="sm" onClick={onSave}>
            {t("common.save")}
          </Button>
          <Button size="sm" variant="outline" onClick={onReset}>
            {t("admin.touchResetDefaults")}
          </Button>
        </div>
      </div>
    </AccordionSection>
  );
}
