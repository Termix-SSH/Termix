import { describe, expect, it } from "vitest";
import { CORE_STEPS } from "@/onboarding/onboarding-steps";
import { computeFlow } from "@/onboarding/onboarding-flow";
import type { OnboardingCtx } from "@/onboarding/onboarding-registry";
import { CORE_ONBOARDING_STEPS } from "@/types/onboarding";
import { UI_AREA_KEYS, PRESETS } from "@/types/ui-preferences";
import en from "@/locales/en.json";

function lookup(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      en,
    );
}

function ctx(overrides: Partial<OnboardingCtx> = {}): OnboardingCtx {
  return {
    mode: "full",
    isAdmin: false,
    isDesktop: false,
    has: () => false,
    pluginSetupPending: false,
    pluginsManagedElsewhere: false,
    canEnrollSecondFactor: false,
    ...overrides,
  };
}

const ids = (c: OnboardingCtx) =>
  computeFlow(CORE_STEPS, {}, c).map((s) => s.id);

describe("CORE_STEPS", () => {
  it("has unique ids, real titles and the versions in CORE_ONBOARDING_STEPS", () => {
    const stepIds = CORE_STEPS.map((s) => s.id);
    expect(new Set(stepIds).size).toBe(stepIds.length);
    expect(stepIds.sort()).toEqual(Object.keys(CORE_ONBOARDING_STEPS).sort());
    for (const step of CORE_STEPS) {
      expect(typeof lookup(step.titleKey), step.titleKey).toBe("string");
      expect(step.version).toBe(
        CORE_ONBOARDING_STEPS[step.id as keyof typeof CORE_ONBOARDING_STEPS],
      );
    }
  });

  it("is only choices: preset and appearance for everyone", () => {
    expect(ids(ctx())).toEqual(["preset", "appearance"]);
  });

  it("opens on the plugin picker for an admin on a fresh install", () => {
    expect(ids(ctx({ isAdmin: true, pluginSetupPending: true }))).toEqual([
      "plugins",
      "preset",
      "appearance",
    ]);
  });

  it("never shows the plugin picker to someone who is not an admin", () => {
    expect(ids(ctx({ pluginSetupPending: true }))).not.toContain("plugins");
    expect(ids(ctx({ mode: "rerun" }))).not.toContain("plugins");
  });

  it("leaves the picker out once it was applied, even on a rerun", () => {
    expect(ids(ctx({ isAdmin: true, mode: "rerun" }))).not.toContain("plugins");
    expect(ids(ctx({ isAdmin: true }))).not.toContain("plugins");
  });

  it("never shows the picker on a linked desktop", () => {
    expect(
      ids(
        ctx({
          isAdmin: true,
          pluginSetupPending: true,
          pluginsManagedElsewhere: true,
        }),
      ),
    ).not.toContain("plugins");
  });

  it("makes the plugin picker required", () => {
    expect(CORE_STEPS.find((s) => s.id === "plugins")?.required).toBe(true);
  });

  it("asks how the desktop app is used only on the desktop", () => {
    expect(ids(ctx({ isDesktop: true }))).toEqual([
      "desktop-sync",
      "preset",
      "appearance",
    ]);
  });

  it("offers account security only when there is something to set up", () => {
    expect(ids(ctx({ canEnrollSecondFactor: true }))).toEqual([
      "preset",
      "appearance",
      "security",
    ]);
  });
});

describe("onboarding translations", () => {
  it("has the copy the stage and the steps show", () => {
    for (const key of [
      "presetIntro",
      "appearanceIntro",
      "securityIntro",
      "pluginsIntro",
      "pluginsRemoveNote",
      "pluginsChoice_enabled",
      "pluginsChoice_disabled",
      "pluginsChoice_remove",
      "pluginsConsentTitle",
      "partialHeading",
      "setupHeading",
      "skipPartial",
      "next",
      "finish",
    ]) {
      expect(lookup(`onboarding.${key}`), key).toBeTypeOf("string");
    }
  });

  it("no longer carries the feature tour", () => {
    const keys = Object.keys(
      (en as Record<string, Record<string, unknown>>).onboarding,
    );
    expect(
      keys.filter((k) => /^(welcome|features|workflow|done)/.test(k)),
    ).toEqual([]);
  });

  it("uses no em dashes", () => {
    const text = JSON.stringify((en as Record<string, unknown>).onboarding);
    expect(text).not.toContain("\u2014");
  });
});

describe("interface settings translations", () => {
  it("has a label for every preset the picker offers", () => {
    for (const preset of ["simple", "balanced", "advanced"]) {
      expect(
        lookup(`newUi.sidebar.userProfile.preset_${preset}`),
        preset,
      ).toBeTypeOf("string");
      expect(
        lookup(`newUi.sidebar.userProfile.preset_${preset}_desc`),
        preset,
      ).toBeTypeOf("string");
    }
  });

  it("has a label for every UI area the override list can show", () => {
    for (const area of UI_AREA_KEYS) {
      expect(
        lookup(`newUi.sidebar.userProfile.uiArea_${area}`),
        area,
      ).toBeTypeOf("string");
    }
  });

  it("covers every area key in each preset", () => {
    for (const preset of ["simple", "balanced", "advanced"] as const) {
      expect(Object.keys(PRESETS[preset]).sort()).toEqual(
        [...UI_AREA_KEYS].sort(),
      );
    }
  });
});
