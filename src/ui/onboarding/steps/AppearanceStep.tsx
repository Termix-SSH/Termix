import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { ACCENT_PRESET_COLORS, applyAccentColor } from "@/lib/theme";
import type { ThemeId } from "@/types/ui-types";

const THEME_CHOICES: { id: ThemeId; swatch: string; labelKey: string }[] = [
  {
    id: "system",
    swatch: "linear-gradient(135deg,#ffffff 50%,#1a1c22 50%)",
    labelKey: "newUi.sidebar.userProfile.themeSystem",
  },
  {
    id: "light",
    swatch: "#ffffff",
    labelKey: "newUi.sidebar.userProfile.themeLight",
  },
  {
    id: "dark",
    swatch: "#1a1c22",
    labelKey: "newUi.sidebar.userProfile.themeDark",
  },
];

export function AppearanceStep() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [accent, setAccent] = useState(
    () =>
      localStorage.getItem("termix-accent") ?? ACCENT_PRESET_COLORS[0].value,
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.appearanceIntro")}
      </p>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("newUi.sidebar.userProfile.themeLabel")}
        </span>
        <div className="grid grid-cols-3 gap-2">
          {THEME_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => setTheme(choice.id)}
              className={`flex items-center gap-2 border p-2 text-xs transition-colors ${
                theme === choice.id
                  ? "border-accent-brand bg-accent-brand/10"
                  : "border-border bg-card hover:bg-muted/40"
              }`}
            >
              <span
                className="size-4 shrink-0 border border-border"
                style={{ background: choice.swatch }}
              />
              {t(choice.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("newUi.sidebar.userProfile.accentColorLabel")}
        </span>
        <div className="grid grid-cols-6 gap-1.5">
          {ACCENT_PRESET_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              title={color.label}
              onClick={() => {
                setAccent(color.value);
                localStorage.setItem("termix-accent", color.value);
                applyAccentColor(color.value);
              }}
              className="flex h-7 items-center justify-center border border-border"
              style={{ background: color.value }}
            >
              {accent === color.value && (
                <Check size={12} className="text-white drop-shadow" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
