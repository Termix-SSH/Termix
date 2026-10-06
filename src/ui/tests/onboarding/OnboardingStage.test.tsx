import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import type { OnboardingStepProps } from "@termix-ssh/plugin-sdk/frontend";

const api = vi.hoisted(() => ({
  getUiPreferences: vi.fn(),
  saveUiPreferences: vi.fn(async (_body: unknown) => {}),
  getUserPreferences: vi.fn(async () => ({ storageMode: "local" })),
}));
vi.mock("@/main-axios", () => api);

vi.mock("@/api/plugins-api", () => ({
  getOnboardingPlugins: vi.fn(async () => ({
    pending: false,
    managedByLinkedServer: false,
    plugins: [],
  })),
}));

const gate = vi.hoisted(() => ({ allow: true }));

function Plain({ label }: { label: string }) {
  return <p>{label} body</p>;
}

function Gated({ setBeforeNext }: OnboardingStepProps) {
  useEffect(() => {
    setBeforeNext(() => gate.allow);
    return () => setBeforeNext(null);
  }, [setBeforeNext]);
  return <p>picker body</p>;
}

vi.mock("@/onboarding/onboarding-steps", () => ({
  CORE_STEPS: [
    {
      id: "preset",
      version: 1,
      titleKey: "preset",
      Component: () => <Plain label="preset" />,
      audience: "all",
      position: 0,
    },
    {
      id: "plugins",
      version: 1,
      titleKey: "picker",
      Component: Gated,
      audience: "all",
      position: 10,
      required: true,
    },
    {
      id: "appearance",
      version: 2,
      titleKey: "appearance",
      Component: () => <Plain label="appearance" />,
      audience: "all",
      position: 40,
    },
    {
      id: "security",
      version: 1,
      titleKey: "security",
      Component: () => <Plain label="security" />,
      audience: "all",
      position: 100,
    },
  ],
}));

import { OnboardingStage } from "@/onboarding/OnboardingStage";
import { UiPreferencesProvider } from "@/contexts/UiPreferencesContext";
import { setPermissionsForTesting } from "@/hooks/use-permissions";
import { onboardingSteps } from "@/onboarding/onboarding-registry";
import {
  defaultUiPreferences,
  type UiPreferences,
} from "@/types/ui-preferences";

function renderStage(
  mode: "full" | "partial" | "rerun",
  preferences: UiPreferences = defaultUiPreferences(),
) {
  const onDone = vi.fn();
  render(
    <UiPreferencesProvider initial={preferences}>
      <OnboardingStage mode={mode} shellReady={false} onDone={onDone} />
    </UiPreferencesProvider>,
  );
  return onDone;
}

const next = () =>
  fireEvent.click(screen.getByRole("button", { name: /onboarding.next|Next/ }));

beforeEach(() => {
  gate.allow = true;
  api.saveUiPreferences.mockClear();
  setPermissionsForTesting([]);
});

afterEach(() => {
  localStorage.clear();
});

describe("OnboardingStage", () => {
  it("hides Skip until the required step is confirmed, then Skip finishes", async () => {
    const onDone = renderStage("full");
    await screen.findByText("preset body");
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();

    next();
    await screen.findByText("picker body");
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();

    await act(async () => next());
    await screen.findByText("appearance body");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /skip/i })),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const body = api.saveUiPreferences.mock.calls.at(-1)?.[0] as {
      onboarding: { skipped: boolean };
    };
    expect(body.onboarding.skipped).toBe(true);
  });

  it("stays on a step whose beforeNext says no", async () => {
    gate.allow = false;
    renderStage("full");
    await screen.findByText("preset body");
    next();
    await screen.findByText("picker body");
    await act(async () => next());
    expect(screen.getByText("picker body")).toBeTruthy();
  });

  it("marks every step in the run as seen when it finishes", async () => {
    const onDone = renderStage("full");
    await screen.findByText("preset body");
    next();
    await screen.findByText("picker body");
    await act(async () => next());
    await screen.findByText("appearance body");
    next();
    await screen.findByText("security body");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /finish|Done/ })),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const body = api.saveUiPreferences.mock.calls.at(-1)?.[0] as {
      onboarding: { seen: Record<string, number> };
    };
    expect(body.onboarding.seen).toEqual({
      preset: 1,
      plugins: 1,
      appearance: 2,
      security: 1,
    });
  });

  it("has no sidebar, just the step and the buttons", async () => {
    renderStage("full");
    await screen.findByText("preset body");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("leaves plugin steps out for someone carried over from an older version", async () => {
    const off = onboardingSteps.register({
      id: "rd:guacd",
      pluginId: "rd",
      version: 1,
      titleKey: "guacd",
      Component: () => <Plain label="guacd" />,
      audience: "all",
      position: 50,
    });
    const preferences = {
      ...defaultUiPreferences(),
      onboarding: {
        seen: { preset: 1, plugins: 1, appearance: 1, security: 1 },
        completedAt: null,
        skipped: false,
        baselinePending: true,
      },
    };
    renderStage("partial", preferences);
    await screen.findByText("appearance body");
    expect(screen.queryByText("guacd body")).toBeNull();
    off();
  });

  it("shows only what someone has not seen on a partial run", async () => {
    const preferences = {
      ...defaultUiPreferences(),
      onboarding: {
        seen: { preset: 1, plugins: 1, appearance: 1, security: 1 },
        completedAt: "2026-01-01T00:00:00.000Z",
        skipped: false,
        baselinePending: false,
      },
    };
    const onDone = renderStage("partial", preferences);
    await screen.findByText("appearance body");
    expect(screen.queryByText("preset body")).toBeNull();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /finish|Done/ })),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
