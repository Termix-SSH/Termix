import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultUiPreferences } from "@/types/ui-preferences";

const mocks = vi.hoisted(() => ({
  getUiPreferences: vi.fn(),
  getOnboardingPlugins: vi.fn(),
  has: vi.fn((_p: string) => false),
  embedded: false,
}));

vi.mock("@/api/ui-preferences-api", () => ({
  getUiPreferences: mocks.getUiPreferences,
}));
vi.mock("@/api/plugins-api", () => ({
  getOnboardingPlugins: mocks.getOnboardingPlugins,
}));
vi.mock("@/hooks/use-permissions", () => ({
  loadPermissionChecker: async () => mocks.has,
}));
vi.mock("@/lib/embedded-frame", () => ({
  isEmbeddedAuthFrame: () => mocks.embedded,
}));
vi.mock("@/onboarding/onboarding-steps", () => ({
  CORE_STEPS: [
    {
      id: "welcome",
      version: 1,
      titleKey: "w",
      Component: () => null,
      audience: "all",
      position: 0,
    },
    {
      id: "plugins",
      version: 1,
      titleKey: "p",
      Component: () => null,
      audience: "admin",
      position: 10,
      isRelevant: (ctx: { pluginSetupPending: boolean }) =>
        ctx.pluginSetupPending,
      forcePending: (ctx: { pluginSetupPending: boolean }) =>
        ctx.pluginSetupPending,
    },
    {
      id: "appearance",
      version: 2,
      titleKey: "a",
      Component: () => null,
      audience: "all",
      position: 40,
    },
  ],
}));

import { resolveStartupOnboarding } from "@/onboarding/startup";
import { onboardingSteps } from "@/onboarding/onboarding-registry";

function prefs(seen: Record<string, number>, extra = {}) {
  return {
    ...defaultUiPreferences(),
    onboarding: {
      seen,
      completedAt: "2026-01-01T00:00:00.000Z",
      skipped: false,
      baselinePending: false,
      ...extra,
    },
  };
}

beforeEach(() => {
  mocks.embedded = false;
  mocks.has.mockReset();
  mocks.has.mockReturnValue(false);
  mocks.getUiPreferences.mockReset();
  mocks.getOnboardingPlugins.mockReset();
  mocks.getOnboardingPlugins.mockResolvedValue({
    pending: false,
    managedByLinkedServer: false,
    plugins: [],
  });
  onboardingSteps.reset();
});

describe("resolveStartupOnboarding", () => {
  it("never runs inside the mobile app or a desktop link window", async () => {
    mocks.embedded = true;
    expect((await resolveStartupOnboarding()).mode).toBeNull();
    expect(mocks.getUiPreferences).not.toHaveBeenCalled();
  });

  it("runs the full flow for a new user", async () => {
    mocks.getUiPreferences.mockResolvedValue(defaultUiPreferences());
    const plan = await resolveStartupOnboarding();
    expect(plan.mode).toBe("full");
    expect(plan.preferences).toBeTruthy();
  });

  it("does not ask for the plugin list as a non-admin", async () => {
    mocks.getUiPreferences.mockResolvedValue(defaultUiPreferences());
    await resolveStartupOnboarding();
    expect(mocks.getOnboardingPlugins).not.toHaveBeenCalled();
  });

  it("shows nothing to someone who has seen everything", async () => {
    mocks.getUiPreferences.mockResolvedValue(
      prefs({ welcome: 1, plugins: 1, appearance: 2 }),
    );
    expect((await resolveStartupOnboarding()).mode).toBeNull();
  });

  it("runs a partial flow for a bumped core step", async () => {
    mocks.getUiPreferences.mockResolvedValue(
      prefs({ welcome: 1, appearance: 1 }),
    );
    expect((await resolveStartupOnboarding()).mode).toBe("partial");
  });

  it("brings an admin back to the picker while it is still pending", async () => {
    mocks.has.mockReturnValue(true);
    mocks.getOnboardingPlugins.mockResolvedValue({
      pending: true,
      managedByLinkedServer: false,
      plugins: [],
    });
    mocks.getUiPreferences.mockResolvedValue(
      prefs({ welcome: 1, plugins: 1, appearance: 2 }),
    );
    const plan = await resolveStartupOnboarding();
    expect(plan.mode).toBe("partial");
    expect(plan.plugins?.pending).toBe(true);
  });

  it("treats a failed plugin list as not pending", async () => {
    mocks.has.mockReturnValue(true);
    mocks.getOnboardingPlugins.mockRejectedValue(new Error("403"));
    mocks.getUiPreferences.mockResolvedValue(
      prefs({ welcome: 1, plugins: 1, appearance: 2 }),
    );
    expect((await resolveStartupOnboarding()).mode).toBeNull();
  });

  it("runs a partial flow for a new plugin step", async () => {
    onboardingSteps.register({
      id: "rd:guacd",
      pluginId: "rd",
      version: 1,
      titleKey: "g",
      Component: () => null,
      audience: "all",
      position: 50,
    });
    mocks.getUiPreferences.mockResolvedValue(
      prefs({ welcome: 1, appearance: 2 }),
    );
    expect((await resolveStartupOnboarding()).mode).toBe("partial");
  });

  it("leaves plugin steps to the baseline pass for carried over users", async () => {
    onboardingSteps.register({
      id: "rd:guacd",
      pluginId: "rd",
      version: 1,
      titleKey: "g",
      Component: () => null,
      audience: "all",
      position: 50,
    });
    mocks.getUiPreferences.mockResolvedValue(
      prefs({ welcome: 1, appearance: 2 }, { baselinePending: true }),
    );
    expect((await resolveStartupOnboarding()).mode).toBeNull();
  });

  it("gives up quietly when preferences cannot load", async () => {
    mocks.getUiPreferences.mockRejectedValue(new Error("offline"));
    expect(await resolveStartupOnboarding()).toEqual({
      preferences: null,
      mode: null,
      plugins: null,
    });
  });
});
