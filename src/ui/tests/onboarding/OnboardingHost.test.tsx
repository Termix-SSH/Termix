import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getUiPreferences: vi.fn(),
  saveUiPreferences: vi.fn(async () => {}),
  getUserPreferences: vi.fn(async () => ({ storageMode: "local" })),
}));
vi.mock("@/main-axios", () => api);

const frame = vi.hoisted(() => ({ embedded: false }));
vi.mock("@/lib/embedded-frame", () => ({
  isEmbeddedAuthFrame: () => frame.embedded,
}));

vi.mock("@/plugin-host/plugin-store", () => ({
  settledPromise: () => Promise.resolve(),
}));

vi.mock("@/onboarding/OnboardingStage", () => ({
  OnboardingStage: ({ mode }: { mode: string }) => <p>stage {mode}</p>,
}));

vi.mock("@/onboarding/onboarding-steps", () => ({
  CORE_STEPS: [
    {
      id: "appearance",
      version: 1,
      titleKey: "a",
      Component: () => null,
      audience: "all",
      position: 40,
    },
  ],
}));

import {
  OnboardingHost,
  OPEN_ONBOARDING_EVENT,
} from "@/onboarding/OnboardingHost";
import { onboardingSteps } from "@/onboarding/onboarding-registry";
import {
  UiPreferencesProvider,
  useUiPreferencesContext,
} from "@/contexts/UiPreferencesContext";
import { setPermissionsForTesting } from "@/hooks/use-permissions";
import { defaultUiPreferences } from "@/types/ui-preferences";

function prefs(extra = {}) {
  return {
    ...defaultUiPreferences(),
    onboarding: {
      seen: { appearance: 1 },
      completedAt: "2026-01-01T00:00:00.000Z",
      skipped: false,
      baselinePending: false,
      ...extra,
    },
  };
}

let seen: Record<string, number> = {};
function SeenProbe() {
  seen = useUiPreferencesContext()?.preferences.onboarding.seen ?? {};
  return null;
}

function renderHost(preferences = prefs()) {
  render(
    <UiPreferencesProvider initial={preferences}>
      <OnboardingHost />
      <SeenProbe />
    </UiPreferencesProvider>,
  );
}

const guacd = {
  id: "rd:guacd",
  pluginId: "rd",
  version: 1,
  titleKey: "g",
  Component: () => null,
  audience: "all" as const,
  position: 50,
};

beforeEach(() => {
  frame.embedded = false;
  setPermissionsForTesting([]);
  onboardingSteps.reset();
});

afterEach(() => {
  localStorage.clear();
});

describe("OnboardingHost", () => {
  it("opens a rerun when settings asks for one", async () => {
    renderHost();
    await act(async () => {
      window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT));
    });
    expect(await screen.findByText("stage rerun")).toBeTruthy();
  });

  it("opens a partial run when a plugin adds a step mid-session", async () => {
    renderHost();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/stage/)).toBeNull();
    act(() => {
      onboardingSteps.register(guacd);
    });
    expect(
      await screen.findByText("stage partial", {}, { timeout: 2000 }),
    ).toBeTruthy();
  });

  it("marks existing plugin steps seen for a carried over user without showing them", async () => {
    onboardingSteps.register(guacd);
    renderHost(prefs({ baselinePending: true }));
    await waitFor(() => expect(seen["rd:guacd"]).toBe(1));
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.queryByText(/stage/)).toBeNull();
  });

  it("does nothing inside an embedded sign in frame", async () => {
    frame.embedded = true;
    onboardingSteps.register(guacd);
    renderHost();
    await act(async () => {
      window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT));
    });
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.queryByText(/stage/)).toBeNull();
  });
});
