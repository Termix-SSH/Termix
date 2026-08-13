import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Gauge,
  Layers,
  RotateCcw,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { useUiPreferencesContext } from "@/contexts/UiPreferencesContext";
import { applyPresetSideEffects } from "@/lib/apply-ui-preset";
import {
  UI_AREA_KEYS,
  type UiAreaKey,
  type UiPreset,
} from "@/types/ui-preferences";

const SELECTABLE_PRESETS: Exclude<UiPreset, "custom">[] = [
  "simple",
  "balanced",
  "advanced",
];

const PRESET_ICONS = {
  simple: Sparkles,
  balanced: Gauge,
  advanced: Wrench,
} as const;

/** Areas that have nothing worth listing as a per-area override. */
const HIDDEN_OVERRIDE_AREAS = new Set<UiAreaKey>(["homepage"]);

export function InterfacePresetSettings({
  onRunSetupAgain,
}: {
  onRunSetupAgain?: () => void;
}) {
  const { t } = useTranslation();
  const ctx = useUiPreferencesContext();
  const [pendingPreset, setPendingPreset] = useState<Exclude<
    UiPreset,
    "custom"
  > | null>(null);
  const [applying, setApplying] = useState(false);

  // The chosen preset stays highlighted even once knobs diverge from it --
  // the customizations are listed separately below.
  const activeLabel = ctx?.preferences.preset ?? "balanced";

  const customizedAreas = useMemo(() => {
    if (!ctx) return [] as UiAreaKey[];
    return UI_AREA_KEYS.filter(
      (area) =>
        !HIDDEN_OVERRIDE_AREAS.has(area) &&
        Object.keys(ctx.preferences.overrides[area] ?? {}).length > 0,
    );
  }, [ctx]);

  if (!ctx) return null;

  async function confirmPreset() {
    if (!pendingPreset) return;
    setApplying(true);
    try {
      ctx.setPreset(pendingPreset);
      // Picking a preset is a deliberate reset, so any knob the user had
      // pinned goes back to following the preset.
      ctx.clearAllOverrides();
      await applyPresetSideEffects(pendingPreset);
    } finally {
      setApplying(false);
      setPendingPreset(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] text-muted-foreground">
        {t("newUi.sidebar.userProfile.interfacePresetDesc")}
      </p>

      {/* Stacked rather than a grid: this panel lives in the sidebar, which
          can be as narrow as 160px, so side-by-side cards would wrap. */}
      <div className="flex flex-col gap-1.5">
        {SELECTABLE_PRESETS.map((preset) => {
          const Icon = PRESET_ICONS[preset];
          const active = activeLabel === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => setPendingPreset(preset)}
              aria-pressed={active}
              className={`flex w-full items-start gap-2 border p-2 text-left transition-colors ${
                active
                  ? "border-accent-brand bg-accent-brand/10"
                  : "border-border bg-card hover:bg-muted/40"
              }`}
            >
              <Icon
                size={13}
                className={`mt-0.5 shrink-0 ${
                  active ? "text-accent-brand" : "text-muted-foreground"
                }`}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs font-semibold">
                  {t(`newUi.sidebar.userProfile.preset_${preset}`)}
                </span>
                <span className="text-[10px] leading-snug text-muted-foreground">
                  {t(`newUi.sidebar.userProfile.preset_${preset}_desc`)}
                </span>
              </span>
              {active && (
                <Check
                  size={12}
                  className="mt-0.5 shrink-0 text-accent-brand"
                />
              )}
            </button>
          );
        })}
      </div>

      {customizedAreas.length > 0 && (
        <div className="flex flex-col gap-1 border border-border bg-card p-2">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Layers size={11} className="shrink-0" />
            <span className="min-w-0 truncate">
              {t("newUi.sidebar.userProfile.presetOverridesTitle")}
            </span>
          </span>
          {customizedAreas.map((area) => (
            <div
              key={area}
              className="flex items-center justify-between gap-2 py-0.5"
            >
              <span className="min-w-0 flex-1 truncate text-xs">
                {t(`newUi.sidebar.userProfile.uiArea_${area}`)}
              </span>
              <button
                type="button"
                onClick={() => ctx.clearArea(area)}
                className="shrink-0 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {t("newUi.sidebar.userProfile.presetRevertArea")}
              </button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="mt-1 h-7 w-full text-[10px]"
            onClick={() => ctx.clearAllOverrides()}
          >
            <RotateCcw size={11} />
            {t("newUi.sidebar.userProfile.presetClearOverrides")}
          </Button>
        </div>
      )}

      {onRunSetupAgain && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <span className="text-[10px] leading-snug text-muted-foreground">
            {t("newUi.sidebar.userProfile.runSetupAgainDesc")}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full text-[10px]"
            onClick={onRunSetupAgain}
          >
            {t("newUi.sidebar.userProfile.runSetupAgainButton")}
          </Button>
        </div>
      )}

      <Dialog
        open={!!pendingPreset}
        onOpenChange={(open) => !open && setPendingPreset(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {t("newUi.sidebar.userProfile.presetConfirmTitle", {
                preset: pendingPreset
                  ? t(`newUi.sidebar.userProfile.preset_${pendingPreset}`)
                  : "",
              })}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("newUi.sidebar.userProfile.presetConfirmDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPendingPreset(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              disabled={applying}
              onClick={confirmPreset}
            >
              {t("newUi.sidebar.userProfile.presetConfirmApply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
