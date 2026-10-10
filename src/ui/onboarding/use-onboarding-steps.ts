import { useMemo } from "react";
import { useActionSlot } from "@/hooks/use-action-slot";
import {
  getActionPermission,
  getSlotContributions,
} from "@/shell/action-registry";
import {
  legacyStepDefs,
  mergeStepDefs,
  onboardingSteps,
  type OnboardingStepDef,
} from "./onboarding-registry";
import { CORE_STEPS } from "./onboarding-steps";
import {
  listLoginMethodUIs,
  listSecondFactorUIs,
  useLoginMethods,
  useSecondFactors,
} from "@/plugin-host/auth-registry";

/** Every onboarding step that exists right now, in flow order. */
export function useOnboardingStepDefs(): OnboardingStepDef[] {
  const registered = onboardingSteps.useList();
  const legacy = useActionSlot("onboarding.steps");
  return useMemo(
    () => mergeStepDefs(CORE_STEPS, registered, legacyStepDefs(legacy)),
    [registered, legacy],
  );
}

/** The same list outside React, for the boot gate and the baseline pass. */
export function currentStepDefs(
  has: (permission: string) => boolean,
): OnboardingStepDef[] {
  const legacy = getSlotContributions("onboarding.steps").filter((c) => {
    const permission = getActionPermission(c.actionId);
    return !permission || has(permission);
  });
  return mergeStepDefs(
    CORE_STEPS,
    onboardingSteps.list(),
    legacyStepDefs(legacy),
  );
}

/** Whether a sign in plugin offers something to set up for the account. */
export function canEnrollSecondFactor(): boolean {
  return [...listLoginMethodUIs(), ...listSecondFactorUIs()].some(
    (entry) => entry.enrollment,
  );
}

export function useCanEnrollSecondFactor(): boolean {
  const methods = useLoginMethods();
  const factors = useSecondFactors();
  return [...methods, ...factors].some((entry) => entry.enrollment);
}
