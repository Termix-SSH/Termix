import { MonitorDown, Puzzle, Shield } from "lucide-react";
import { CORE_ONBOARDING_STEPS } from "@/types/onboarding";
import { PluginsStep } from "./steps/PluginsStep";
import { SecurityStep } from "./steps/SecurityStep";
import { DesktopUpdatesStep } from "./steps/DesktopUpdatesStep";
import { desktopUpdates } from "@/lib/desktop-updates";
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
    id: "desktop-updates",
    version: CORE_ONBOARDING_STEPS["desktop-updates"],
    titleKey: "desktopUpdates.onboardingTitle",
    icon: MonitorDown,
    Component: DesktopUpdatesStep,
    audience: "all",
    position: 25,
    // App Store builds have no updater.
    isRelevant: (ctx) => ctx.isDesktop && desktopUpdates() !== null,
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
