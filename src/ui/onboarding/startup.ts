import { getUiPreferences } from "@/api/ui-preferences-api";
import {
  getOnboardingPlugins,
  type OnboardingPluginList,
} from "@/api/plugins-api";
import { loadPermissionChecker } from "@/hooks/use-permissions";
import { isElectron } from "@/lib/electron";
import { isEmbeddedAuthFrame } from "@/lib/embedded-frame";
import type { UiPreferences } from "@/types/ui-preferences";
import {
  computeFlow,
  needsFullFlow,
  ONBOARDING_ADMIN_PERMISSION,
} from "./onboarding-flow";
import type { OnboardingCtx, OnboardingMode } from "./onboarding-registry";
import { canEnrollSecondFactor, currentStepDefs } from "./use-onboarding-steps";

export interface StartupOnboarding {
  preferences: UiPreferences | null;
  /** Null when there is nothing to show. */
  mode: Exclude<OnboardingMode, "rerun"> | null;
  plugins: OnboardingPluginList | null;
}

/**
 * Decides, after sign in and once plugins have loaded, whether the app opens
 * on onboarding: the full run for a new user, or just the steps someone has
 * not seen yet. Never inside the mobile app or a desktop's link window,
 * which only borrow this page to sign in.
 */
export async function resolveStartupOnboarding(): Promise<StartupOnboarding> {
  const none: StartupOnboarding = {
    preferences: null,
    mode: null,
    plugins: null,
  };
  if (isEmbeddedAuthFrame()) return none;
  if (new URLSearchParams(window.location.search).has("view")) return none;

  let preferences: UiPreferences;
  try {
    preferences = await getUiPreferences();
  } catch {
    return none;
  }

  const has = await loadPermissionChecker();
  const isAdmin = has(ONBOARDING_ADMIN_PERMISSION);
  const plugins = isAdmin
    ? await getOnboardingPlugins().catch(() => null)
    : null;

  const result: StartupOnboarding = { preferences, mode: null, plugins };
  const { onboarding } = preferences;

  if (needsFullFlow(onboarding)) return { ...result, mode: "full" };

  const ctx: OnboardingCtx = {
    mode: "partial",
    isAdmin,
    isDesktop: isElectron(),
    has,
    pluginSetupPending: !!plugins?.pending,
    pluginsManagedElsewhere: !!plugins?.managedByLinkedServer,
    canEnrollSecondFactor: canEnrollSecondFactor(),
  };
  const steps = currentStepDefs(has);
  // Someone carried over from the old onboarding has their plugin steps
  // marked seen by the shell first, so only core steps count for them here.
  const candidates = onboarding.baselinePending
    ? steps.filter((step) => !step.pluginId)
    : steps;
  const pending = computeFlow(candidates, onboarding.seen, ctx);
  return { ...result, mode: pending.length > 0 ? "partial" : null };
}
