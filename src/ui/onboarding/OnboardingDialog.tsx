import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { useUiPreferencesContext } from "@/contexts/UiPreferencesContext";
import { relevantSteps, type OnboardingContext } from "./onboarding-steps";

export function OnboardingDialog({
  open,
  context,
  onClose,
  onAddHost,
}: {
  open: boolean;
  context: OnboardingContext;
  onClose: (skipped: boolean) => void;
  onAddHost: () => void;
}) {
  const { t } = useTranslation();
  const ctx = useUiPreferencesContext();
  const steps = useMemo(() => relevantSteps(context), [context]);
  const [index, setIndex] = useState(0);

  // A reopened run always starts from the top.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  if (steps.length === 0) return null;

  const clamped = Math.min(index, steps.length - 1);
  const step = steps[clamped];
  const isLast = clamped === steps.length - 1;
  const StepComponent = step.Component;

  function finish(skipped: boolean) {
    ctx?.completeOnboarding(skipped);
    onClose(skipped);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(true);
      }}
    >
      <DialogContent
        className="sm:max-w-xl max-h-[85vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-bold">
            {t(step.titleKey)}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("onboarding.stepCounter", {
              current: clamped + 1,
              total: steps.length,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1">
          <StepComponent context={context} onAddHost={onAddHost} />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === clamped ? "bg-accent-brand" : "bg-muted-foreground/25"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!isLast && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => finish(true)}
              >
                {t("onboarding.skip")}
              </Button>
            )}
            {clamped > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setIndex(clamped - 1)}
              >
                <ArrowLeft size={12} />
                {t("common.back")}
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => (isLast ? finish(false) : setIndex(clamped + 1))}
            >
              {isLast ? t("onboarding.finish") : t("onboarding.next")}
              {!isLast && <ArrowRight size={12} />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
