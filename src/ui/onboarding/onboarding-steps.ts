import type { ComponentType } from "react";
import { WelcomeStep } from "./steps/WelcomeStep";
import { PresetStep } from "./steps/PresetStep";
import { AppearanceStep } from "./steps/AppearanceStep";
import { FeaturesStep } from "./steps/FeaturesStep";
import { WorkflowStep } from "./steps/WorkflowStep";
import { SecurityStep } from "./steps/SecurityStep";
import { DoneStep } from "./steps/DoneStep";
import { DesktopSyncStep } from "./steps/DesktopSyncStep";
import { isElectron } from "@/lib/electron";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OnboardingContext {}

export interface OnboardingStepProps {
  context: OnboardingContext;
}

export interface OnboardingStep {
  id: string;
  titleKey: string;
  Component: ComponentType<OnboardingStepProps>;
  /** Steps that do not apply to this account are skipped entirely. */
  isRelevant?: (context: OnboardingContext) => boolean;
}

/**
 * Onboarding as data rather than hardcoded JSX, so steps can be added,
 * reordered or made conditional without touching the dialog shell. Plugins
 * add steps through the "onboarding.steps" slot; they land before security.
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    titleKey: "onboarding.welcomeTitle",
    Component: WelcomeStep,
  },
  { id: "preset", titleKey: "onboarding.presetTitle", Component: PresetStep },
  {
    id: "desktop-sync",
    titleKey: "onboarding.desktopTitle",
    Component: DesktopSyncStep,
    isRelevant: () => isElectron(),
  },
  {
    id: "appearance",
    titleKey: "onboarding.appearanceTitle",
    Component: AppearanceStep,
  },
  {
    id: "features",
    titleKey: "onboarding.featuresTitle",
    Component: FeaturesStep,
  },
  {
    id: "workflow",
    titleKey: "onboarding.workflowTitle",
    Component: WorkflowStep,
  },
  {
    id: "security",
    titleKey: "onboarding.securityTitle",
    Component: SecurityStep,
  },
  { id: "done", titleKey: "onboarding.doneTitle", Component: DoneStep },
];

export function relevantSteps(context: OnboardingContext): OnboardingStep[] {
  return ONBOARDING_STEPS.filter(
    (step) => !step.isRelevant || step.isRelevant(context),
  );
}
