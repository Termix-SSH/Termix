import { useTranslation } from "react-i18next";
import { Gauge, Sparkles, Wrench } from "lucide-react";
import { useUiPreferencesContext } from "@/contexts/UiPreferencesContext";
import { applyPresetSideEffects } from "@/lib/apply-ui-preset";
import { PRESETS, type UiPreset } from "@/types/ui-preferences";

const CHOICES: Exclude<UiPreset, "custom">[] = [
  "simple",
  "balanced",
  "advanced",
];

const ICONS = { simple: Sparkles, balanced: Gauge, advanced: Wrench } as const;

/**
 * A miniature of the host list at the given preset. Deliberately drawn rather
 * than rendering the real component: the point is to show the shape difference
 * (how many rows fit, how much detail each carries) at a glance.
 */
function HostRowPreview({ preset }: { preset: Exclude<UiPreset, "custom"> }) {
  const { hostList } = PRESETS[preset];
  const rows = hostList.density === "compact" ? 5 : 3;

  return (
    <div className="flex flex-col gap-[3px] border border-border/60 bg-background/60 p-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-stretch gap-1">
          {hostList.showStatusStripes && (
            <div className="w-[2px] shrink-0 bg-accent-brand/70" />
          )}
          <div className="flex flex-1 flex-col gap-[2px] py-[2px]">
            <div className="h-[3px] w-2/3 bg-muted-foreground/40" />
            {hostList.density === "comfortable" && (
              <div className="h-[2px] w-1/2 bg-muted-foreground/20" />
            )}
            {hostList.showTags && (
              <div className="flex gap-[2px]">
                <div className="h-[3px] w-3 bg-muted-foreground/20" />
                <div className="h-[3px] w-2 bg-muted-foreground/20" />
              </div>
            )}
            {hostList.showResourceBars && (
              <div className="flex gap-[2px]">
                <div className="h-[2px] w-4 bg-accent-brand/40" />
                <div className="h-[2px] w-3 bg-accent-brand/25" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PresetStep() {
  const { t } = useTranslation();
  const ctx = useUiPreferencesContext();
  const selected = ctx?.preferences.preset ?? "balanced";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.presetIntro")}
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {CHOICES.map((preset) => {
          const Icon = ICONS[preset];
          const active = selected === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={active}
              onClick={() => {
                ctx?.setPreset(preset);
                ctx?.clearAllOverrides();
                void applyPresetSideEffects(preset);
              }}
              className={`flex flex-col gap-2 border p-2.5 text-left transition-colors ${
                active
                  ? "border-accent-brand bg-accent-brand/10"
                  : "border-border bg-card hover:bg-muted/40"
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <Icon
                  size={13}
                  className={
                    active ? "text-accent-brand" : "text-muted-foreground"
                  }
                />
                {t(`newUi.sidebar.userProfile.preset_${preset}`)}
              </span>
              <HostRowPreview preset={preset} />
              <span className="text-[10px] leading-snug text-muted-foreground">
                {t(`newUi.sidebar.userProfile.preset_${preset}_desc`)}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground/70">
        {t("onboarding.presetChangeLater")}
      </p>
    </div>
  );
}
