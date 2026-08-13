import type { ComponentType } from "react";
import { WelcomeStep } from "./steps/WelcomeStep";
import { PresetStep } from "./steps/PresetStep";
import { AppearanceStep } from "./steps/AppearanceStep";
import { FeaturesStep } from "./steps/FeaturesStep";
import { WorkflowStep } from "./steps/WorkflowStep";
import { SecurityStep } from "./steps/SecurityStep";
import { FirstHostStep } from "./steps/FirstHostStep";
import { DoneStep } from "./steps/DoneStep";

export interface OnboardingContext {
  /** Whether the account already has hosts (imported, synced or shared). */
  hasHosts: boolean;
}

export interface OnboardingStepProps {
  context: OnboardingContext;
  /** Closes onboarding and jumps straight to adding a host. */
  onAddHost: () => void;
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
 * reordered or made conditional without touching the dialog shell.
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    titleKey: "onboarding.welcomeTitle",
    Component: WelcomeStep,
  },
  { id: "preset", titleKey: "onboarding.presetTitle", Component: PresetStep },
  {
    id: "appearance",
    titleKey: "onboarding.appearanceTitle",
    Component: AppearanceStep,
  },
  {
    id: "first-host",
    titleKey: "onboarding.firstHostTitle",
    Component: FirstHostStep,
    // Nothing to offer someone who already has hosts.
    isRelevant: (context) => !context.hasHosts,
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
