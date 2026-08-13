import { describe, expect, it } from "vitest";
import { ONBOARDING_STEPS, relevantSteps } from "@/onboarding/onboarding-steps";
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

describe("ONBOARDING_STEPS", () => {
  it("has unique ids and real title translations", () => {
    const ids = ONBOARDING_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const step of ONBOARDING_STEPS) {
      expect(typeof lookup(step.titleKey), step.titleKey).toBe("string");
    }
  });

  it("opens with the preset picker right after the welcome", () => {
    expect(ONBOARDING_STEPS[0].id).toBe("welcome");
    expect(ONBOARDING_STEPS[1].id).toBe("preset");
  });

  it("drops the add-a-host step for accounts that already have hosts", () => {
    const withHosts = relevantSteps({
      hasHosts: true,
      aiGloballyEnabled: false,
    }).map((s) => s.id);
    const without = relevantSteps({
      hasHosts: false,
      aiGloballyEnabled: false,
    }).map((s) => s.id);
    expect(withHosts).not.toContain("first-host");
    expect(without).toContain("first-host");
  });

  it("ends on the done step for either kind of account", () => {
    for (const hasHosts of [true, false]) {
      const ids = relevantSteps({ hasHosts, aiGloballyEnabled: false }).map(
        (s) => s.id,
      );
      expect(ids[ids.length - 1]).toBe("done");
    }
  });

  it("only offers the AI step when an admin has enabled the assistant", () => {
    // A user on an instance with AI switched off should never be told the
    // feature exists, so the step has to disappear rather than render disabled.
    const off = relevantSteps({
      hasHosts: true,
      aiGloballyEnabled: false,
    }).map((s) => s.id);
    const on = relevantSteps({ hasHosts: true, aiGloballyEnabled: true }).map(
      (s) => s.id,
    );
    expect(off).not.toContain("ai");
    expect(on).toContain("ai");
  });

  it("tours the feature set after the setup choices", () => {
    const ids = ONBOARDING_STEPS.map((s) => s.id);
    for (const id of ["features", "workflow", "security"]) {
      expect(ids).toContain(id);
      expect(ids.indexOf(id)).toBeGreaterThan(ids.indexOf("appearance"));
    }
  });
});

describe("onboarding step body translations", () => {
  const KEYS: Record<string, string[]> = {
    welcome: ["hosts", "terminal", "files"],
    feature: [
      "files",
      "desktop",
      "tunnels",
      "docker",
      "snippets",
      "automations",
      "metrics",
    ],
    workflow: ["palette", "split", "dock", "workspaces"],
    security: ["credentials", "twofa", "identity", "sharing"],
    done: ["settings", "rerun", "docs"],
  };

  it("has a title and description for every card the steps render", () => {
    for (const [prefix, keys] of Object.entries(KEYS)) {
      for (const key of keys) {
        expect(
          lookup(`onboarding.${prefix}_${key}`),
          `${prefix}_${key}`,
        ).toBeTypeOf("string");
        expect(
          lookup(`onboarding.${prefix}_${key}_desc`),
          `${prefix}_${key}_desc`,
        ).toBeTypeOf("string");
      }
    }
  });

  it("has the intro copy each step shows above its cards", () => {
    for (const key of [
      "welcomeIntro",
      "presetIntro",
      "appearanceIntro",
      "firstHostIntro",
      "featuresIntro",
      "workflowIntro",
      "securityIntro",
      "aiIntro",
      "aiEnableTitle",
      "aiEnableDesc",
      "aiSkipTitle",
      "aiSkipDesc",
      "aiNote",
      "doneDesc",
    ]) {
      expect(lookup(`onboarding.${key}`), key).toBeTypeOf("string");
    }
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
