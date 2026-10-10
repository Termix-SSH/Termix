import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AccentPicker,
  FontSizePicker,
  LanguageSelect,
  ThemeGrid,
  UiFontSelect,
  useAppearanceSettings,
} from "@/settings/appearance/appearance-controls";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

/** Every change applies right away, so the page itself is the preview. */
export function AppearanceStep() {
  const { t } = useTranslation();
  const appearance = useAppearanceSettings();

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.appearanceIntro")}
      </p>

      <Field label={t("newUi.sidebar.userProfile.themeLabel")}>
        <ThemeGrid value={appearance.theme} onChange={appearance.setTheme} />
      </Field>

      <Field label={t("newUi.sidebar.userProfile.accentColorLabel")}>
        <AccentPicker
          value={appearance.accent}
          onChange={appearance.setAccent}
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          label={t("newUi.sidebar.userProfile.interfaceFontLabel")}
          hint={t("newUi.sidebar.userProfile.interfaceFontDescription")}
        >
          <UiFontSelect
            value={appearance.uiFont}
            onChange={appearance.setUiFont}
          />
        </Field>
        <Field label={t("newUi.sidebar.userProfile.fontSizeLabel")}>
          <FontSizePicker
            value={appearance.fontSize}
            onChange={appearance.setFontSize}
          />
        </Field>
      </div>

      <Field label={t("newUi.sidebar.userProfile.languageLabel")}>
        <LanguageSelect
          value={appearance.language}
          onChange={appearance.setLanguage}
        />
      </Field>
    </div>
  );
}
