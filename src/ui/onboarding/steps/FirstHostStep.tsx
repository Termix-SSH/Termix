import { useTranslation } from "react-i18next";
import { Plus, Server } from "lucide-react";
import { Button } from "@/components/button";
import type { OnboardingStepProps } from "../onboarding-steps";

export function FirstHostStep({ onAddHost }: OnboardingStepProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.firstHostIntro")}
      </p>

      <div className="flex flex-col items-center gap-3 border border-border bg-card px-4 py-6 text-center">
        <Server size={22} className="text-muted-foreground/40" />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium">
            {t("onboarding.firstHostHeading")}
          </span>
          <span className="text-[10px] leading-snug text-muted-foreground">
            {t("onboarding.firstHostDesc")}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
          onClick={onAddHost}
        >
          <Plus size={12} />
          {t("onboarding.firstHostAdd")}
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground/70">
        {t("onboarding.firstHostLater")}
      </p>
    </div>
  );
}
