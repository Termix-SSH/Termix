import { describe, expect, it, vi } from "vitest";
import { ONBOARDING_STEPS, relevantSteps } from "@/onboarding/onboarding-steps";
import { UI_AREA_KEYS, PRESETS } from "@/types/ui-preferences";
import en from "@/locales/en.json";

const isElectron = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/electron", () => ({ isElectron }));

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

  it("has no add-a-host step, which used to close onboarding mid-flow", () => {
    const ids = relevantSteps({}).map((s) => s.id);
    expect(ids).not.toContain("first-host");
  });

  it("asks how the desktop app is used only on the desktop", () => {
    isElectron.mockReturnValue(false);
    expect(relevantSteps({}).map((s) => s.id)).not.toContain("desktop-sync");
    isElectron.mockReturnValue(true);
    expect(relevantSteps({}).map((s) => s.id)).toContain("desktop-sync");
    isElectron.mockReturnValue(false);
  });

  it("ends on the done step", () => {
    const ids = relevantSteps({}).map((s) => s.id);
    expect(ids[ids.length - 1]).toBe("done");
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
    feature: ["files", "tunnels"],
    workflow: ["palette", "split", "dock"],
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
      "featuresIntro",
      "workflowIntro",
      "securityIntro",
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
