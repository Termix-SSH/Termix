import { LayoutTemplate, Monitor, Palette, Puzzle, Shield } from "lucide-react";
import { CORE_ONBOARDING_STEPS } from "@/types/onboarding";
import { PluginsStep } from "./steps/PluginsStep";
import { PresetStep } from "./steps/PresetStep";
import { AppearanceStep } from "./steps/AppearanceStep";
import { SecurityStep } from "./steps/SecurityStep";
import { DesktopSyncStep } from "./steps/DesktopSyncStep";
import type { OnboardingStepDef } from "./onboarding-registry";

/**
 * Core onboarding as data: only choices, no tour. Plugin steps slot in
 * between these by section (see SECTION_POSITION). To show a changed step
 * again to people who saw it, bump its version in CORE_ONBOARDING_STEPS;
 * only that step reruns.
 */
export const CORE_STEPS: OnboardingStepDef[] = [
  {
    id: "plugins",
    version: CORE_ONBOARDING_STEPS.plugins,
    titleKey: "onboarding.pluginsTitle",
    icon: Puzzle,
    Component: PluginsStep,
    audience: "admin",
    position: 10,
    required: true,
    // Once applied there is nothing to redo here; the Plugins tab is where
    // plugins change after that, so a rerun leaves it out.
    isRelevant: (ctx) => !ctx.pluginsManagedElsewhere && ctx.pluginSetupPending,
    forcePending: (ctx) => ctx.pluginSetupPending,
  },
  {
    id: "desktop-sync",
    version: CORE_ONBOARDING_STEPS["desktop-sync"],
    titleKey: "onboarding.desktopTitle",
    icon: Monitor,
    Component: DesktopSyncStep,
    audience: "all",
    position: 20,
    isRelevant: (ctx) => ctx.isDesktop,
  },
  {
    id: "preset",
    version: CORE_ONBOARDING_STEPS.preset,
    titleKey: "onboarding.presetTitle",
    icon: LayoutTemplate,
    Component: PresetStep,
    audience: "all",
    position: 30,
  },
  {
    id: "appearance",
    version: CORE_ONBOARDING_STEPS.appearance,
    titleKey: "onboarding.appearanceTitle",
    icon: Palette,
    Component: AppearanceStep,
    audience: "all",
    position: 40,
  },
  {
    id: "security",
    version: CORE_ONBOARDING_STEPS.security,
    titleKey: "onboarding.securityTitle",
    icon: Shield,
    Component: SecurityStep,
    audience: "all",
    position: 90,
    // The desktop signs its local account in by itself, so a second factor
    // set up there would never be asked for.
    isRelevant: (ctx) => !ctx.isDesktop && ctx.canEnrollSecondFactor === true,
  },
];
