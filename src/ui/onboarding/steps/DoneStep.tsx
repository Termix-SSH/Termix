import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";

export function DoneStep() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <CheckCircle2 size={26} className="text-accent-brand" />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">
          {t("onboarding.doneHeading")}
        </span>
        <span className="max-w-sm text-[11px] leading-snug text-muted-foreground">
          {t("onboarding.doneDesc")}
        </span>
      </div>
      <p className="max-w-sm text-[10px] leading-snug text-muted-foreground/70">
        {t("onboarding.doneSettingsHint")}
      </p>
    </div>
  );
}
