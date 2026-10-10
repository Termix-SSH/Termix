import { describe, expect, it } from "vitest";
import {
  baselineSeen,
  computeFlow,
  needsFullFlow,
  seenFor,
} from "@/onboarding/onboarding-flow";
import {
  mergeStepDefs,
  sectionPosition,
  type OnboardingCtx,
  type OnboardingStepDef,
} from "@/onboarding/onboarding-registry";
import { defaultOnboardingState } from "@/types/ui-preferences";

const Noop = () => null;

function step(
  id: string,
  position: number,
  extra: Partial<OnboardingStepDef> = {},
): OnboardingStepDef {
  return {
    id,
    version: 1,
    titleKey: id,
    Component: Noop,
    audience: "all",
    position,
    ...extra,
  };
}

function ctx(overrides: Partial<OnboardingCtx> = {}): OnboardingCtx {
  return {
    mode: "partial",
    isAdmin: false,
    isDesktop: false,
    has: () => false,
    pluginSetupPending: false,
    pluginsManagedElsewhere: false,
    ...overrides,
  };
}

const steps = [
  step("welcome", 0),
  step("appearance", 40, { version: 2 }),
  step("rd:guacd", sectionPosition("setup"), {
    pluginId: "rd",
    audience: "admin",
  }),
  step("ai:assistant", sectionPosition("explore"), {
    pluginId: "ai",
    permission: "ai.use",
  }),
  step("done", 100),
];

const ids = (list: OnboardingStepDef[]) => list.map((s) => s.id);

describe("computeFlow", () => {
  it("shows every relevant step on a full run", () => {
    expect(ids(computeFlow(steps, {}, ctx({ mode: "full" })))).toEqual([
      "welcome",
      "appearance",
      "done",
    ]);
  });

  it("filters admin and permission steps", () => {
    const flow = computeFlow(
      steps,
      {},
      ctx({ mode: "rerun", isAdmin: true, has: (p) => p === "ai.use" }),
    );
    expect(ids(flow)).toEqual([
      "welcome",
      "appearance",
      "rd:guacd",
      "ai:assistant",
      "done",
    ]);
  });

  it("shows only unseen or bumped steps on a partial run", () => {
    const flow = computeFlow(
      steps,
      { welcome: 1, appearance: 1, "rd:guacd": 1, done: 1 },
      ctx({ isAdmin: true, has: () => true }),
    );
    expect(ids(flow)).toEqual(["appearance", "ai:assistant"]);
  });

  it("is empty when everything is seen", () => {
    expect(
      computeFlow(
        steps,
        { welcome: 1, appearance: 2, "rd:guacd": 1, done: 1 },
        ctx({ isAdmin: true }),
      ),
    ).toEqual([]);
  });

  it("includes a seen step that forces itself pending", () => {
    const picker = step("plugins", 10, {
      forcePending: (c) => c.pluginSetupPending,
    });
    expect(
      ids(
        computeFlow(
          [picker],
          { plugins: 1 },
          ctx({ pluginSetupPending: true }),
        ),
      ),
    ).toEqual(["plugins"]);
    expect(computeFlow([picker], { plugins: 1 }, ctx())).toEqual([]);
  });

  it("drops a step whose relevance check throws", () => {
    const broken = step("x:y", 50, {
      isRelevant: () => {
        throw new Error("boom");
      },
    });
    expect(computeFlow([broken], {}, ctx())).toEqual([]);
  });
});

describe("seen bookkeeping", () => {
  it("records every step in a run at its version", () => {
    expect(seenFor(steps.slice(0, 2))).toEqual({ welcome: 1, appearance: 2 });
  });

  it("baselines only plugin steps", () => {
    expect(baselineSeen(steps)).toEqual({ "rd:guacd": 1, "ai:assistant": 1 });
  });

  it("needs the full run only for someone who never finished one", () => {
    expect(needsFullFlow(defaultOnboardingState())).toBe(true);
    expect(
      needsFullFlow({ ...defaultOnboardingState(), seen: { welcome: 1 } }),
    ).toBe(false);
    expect(
      needsFullFlow({ ...defaultOnboardingState(), completedAt: "x" }),
    ).toBe(false);
  });
});

describe("mergeStepDefs", () => {
  it("orders by position and lets a registered step win over a legacy one", () => {
    const legacy = step("ai:assistant", 80, { titleKey: "old" });
    const registered = step("ai:assistant", 50, { titleKey: "new" });
    const merged = mergeStepDefs(
      [step("welcome", 0), step("done", 100)],
      [registered],
      [legacy, step("x:legacy", 80)],
    );
    expect(merged.map((s) => [s.id, s.titleKey])).toEqual([
      ["welcome", "welcome"],
      ["ai:assistant", "new"],
      ["x:legacy", "x:legacy"],
      ["done", "done"],
    ]);
  });

  it("places plugin sections between the core steps", () => {
    expect(sectionPosition("setup")).toBeGreaterThan(40);
    expect(sectionPosition("setup")).toBeLessThan(60);
    expect(sectionPosition("explore", 1000)).toBeLessThan(90);
    expect(sectionPosition("security")).toBeLessThan(100);
  });
});
