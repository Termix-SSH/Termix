import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type {
  OnboardingMode,
  OnboardingSection,
  OnboardingStepProps,
} from "@termix-ssh/plugin-sdk/frontend";
import { createRegistry } from "@/lib/registry";
import type { SlotContribution } from "@/shell/action-registry";
import { pluginStepKey } from "@/types/onboarding";

export type { OnboardingMode, OnboardingSection, OnboardingStepProps };

export interface OnboardingCtx {
  mode: OnboardingMode;
  isAdmin: boolean;
  isDesktop: boolean;
  has: (permission: string) => boolean;
  /** True on a fresh install until an admin confirms the plugin picker. */
  pluginSetupPending: boolean;
  /** A linked desktop runs what its server runs. */
  pluginsManagedElsewhere: boolean;
  /** Whether a sign in plugin offers a passkey or authenticator to set up. */
  canEnrollSecondFactor?: boolean;
}

export interface OnboardingStepDef {
  /** The key stored in the seen map: a core id, or `<pluginId>:<id>`. */
  id: string;
  pluginId?: string;
  version: number;
  titleKey: string;
  descriptionKey?: string;
  icon?: LucideIcon | ComponentType<{ size?: number; className?: string }>;
  Component: ComponentType<OnboardingStepProps>;
  audience: "all" | "admin";
  permission?: string;
  /** Position in the flow; plugin steps get theirs from their section. */
  position: number;
  isRelevant?: (ctx: OnboardingCtx) => boolean;
  /** Shown in a partial run even when already seen. */
  forcePending?: (ctx: OnboardingCtx) => boolean;
  /** Skip stays hidden until this step has been confirmed. */
  required?: boolean;
}

/** Where each section of plugin steps sits among the core steps. */
export const SECTION_POSITION: Record<OnboardingSection, number> = {
  setup: 50,
  explore: 80,
  security: 95,
};

export const onboardingSteps = createRegistry<OnboardingStepDef>();

/** Plugin steps sort inside their section by order, then key. */
export function sectionPosition(
  section: OnboardingSection | undefined,
  order = 0,
): number {
  const base = SECTION_POSITION[section ?? "explore"];
  return base + Math.max(-1, Math.min(1, order / 1000)) * 0.4;
}

export function sortSteps(steps: OnboardingStepDef[]): OnboardingStepDef[] {
  return [...steps].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
}

/** Steps still on the deprecated onboarding.steps slot, read as version 1. */
export function legacyStepDefs(
  contributions: SlotContribution[],
): OnboardingStepDef[] {
  return contributions
    .filter((c) => c.component && c.pluginId)
    .map((c) => ({
      id: pluginStepKey(c.pluginId!, c.actionId),
      pluginId: c.pluginId,
      version: 1,
      titleKey: c.titleKey,
      descriptionKey: c.descriptionKey,
      icon: c.icon as OnboardingStepDef["icon"],
      Component: c.component as unknown as ComponentType<OnboardingStepProps>,
      audience: "all" as const,
      position: sectionPosition("explore", c.order),
    }));
}

/** Core, registered and legacy steps in flow order, registered winning ties. */
export function mergeStepDefs(
  core: OnboardingStepDef[],
  registered: OnboardingStepDef[],
  legacy: OnboardingStepDef[],
): OnboardingStepDef[] {
  const keys = new Set([...core, ...registered].map((step) => step.id));
  return sortSteps([
    ...core,
    ...registered,
    ...legacy.filter((step) => !keys.has(step.id)),
  ]);
}
