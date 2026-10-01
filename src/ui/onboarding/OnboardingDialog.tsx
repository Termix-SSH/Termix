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
import { useActionSlot } from "@/hooks/use-action-slot";
import {
  relevantSteps,
  type OnboardingContext,
  type OnboardingStep,
} from "./onboarding-steps";

/** Plugin steps go in before this one. */
const PLUGIN_STEPS_BEFORE = "security";

export function OnboardingDialog({
  open,
  context,
  onClose,
}: {
  open: boolean;
  context: OnboardingContext;
  onClose: (skipped: boolean) => void;
}) {
  const { t } = useTranslation();
  const ctx = useUiPreferencesContext();
  const pluginSteps = useActionSlot("onboarding.steps");
  const steps = useMemo(() => {
    const core = relevantSteps(context);
    const extra: OnboardingStep[] = pluginSteps
      .filter((contribution) => contribution.component)
      .map((contribution) => ({
        id: contribution.actionId,
        titleKey: contribution.titleKey,
        Component:
          contribution.component as unknown as OnboardingStep["Component"],
      }));
    const at = core.findIndex((step) => step.id === PLUGIN_STEPS_BEFORE);
    return at < 0
      ? [...core, ...extra]
      : [...core.slice(0, at), ...extra, ...core.slice(at)];
  }, [context, pluginSteps]);
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

        <div className="h-0.5 w-full bg-muted-foreground/15">
          <div
            className="h-full bg-accent-brand transition-all duration-200"
            style={{ width: `${((clamped + 1) / steps.length) * 100}%` }}
          />
        </div>

        <div className="mt-1">
          <StepComponent context={context} />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                title={t(s.titleKey)}
                aria-label={t(s.titleKey)}
                aria-current={i === clamped}
                onClick={() => setIndex(i)}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === clamped
                    ? "bg-accent-brand"
                    : "bg-muted-foreground/25 hover:bg-muted-foreground/50"
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
              variant="outline"
              className="h-7 text-[11px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
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
