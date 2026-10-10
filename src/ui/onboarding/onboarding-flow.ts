import type { UiOnboardingState } from "@/types/ui-preferences";
import type { OnboardingCtx, OnboardingStepDef } from "./onboarding-registry";

/** The permission that makes someone an admin as far as onboarding goes. */
export const ONBOARDING_ADMIN_PERMISSION = "admin.plugins.manage";

export function isStepRelevant(
  step: OnboardingStepDef,
  ctx: OnboardingCtx,
): boolean {
  if (step.audience === "admin" && !ctx.isAdmin) return false;
  if (step.permission && !ctx.has(step.permission)) return false;
  if (step.isRelevant) {
    try {
      if (!step.isRelevant(ctx)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function isStepPending(
  step: OnboardingStepDef,
  seen: Record<string, number>,
  ctx: OnboardingCtx,
): boolean {
  if ((seen[step.id] ?? 0) < step.version) return true;
  try {
    return step.forcePending?.(ctx) === true;
  } catch {
    return false;
  }
}

/**
 * The steps a run shows, in order. A full run or a rerun shows every step
 * that applies to the user; a partial run only the ones they have not seen
 * at their current version.
 */
export function computeFlow(
  steps: OnboardingStepDef[],
  seen: Record<string, number>,
  ctx: OnboardingCtx,
): OnboardingStepDef[] {
  const relevant = steps.filter((step) => isStepRelevant(step, ctx));
  if (ctx.mode !== "partial") return relevant;
  return relevant.filter((step) => isStepPending(step, seen, ctx));
}

/** A user who has never finished or skipped a run gets the full one. */
export function needsFullFlow(state: UiOnboardingState): boolean {
  return Object.keys(state.seen).length === 0 && !state.completedAt;
}

/** What to record once a run ends, finished or skipped. */
export function seenFor(steps: OnboardingStepDef[]): Record<string, number> {
  return Object.fromEntries(steps.map((step) => [step.id, step.version]));
}

/**
 * For a user carried over from the old onboarding: every plugin step that
 * exists right now counts as seen, so the upgrade does not show them a pile
 * of steps for plugins they have been using all along.
 */
export function baselineSeen(
  steps: OnboardingStepDef[],
): Record<string, number> {
  return seenFor(steps.filter((step) => step.pluginId));
}
