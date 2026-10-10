import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { OnboardingPluginList } from "@/api/plugins-api";

const api = vi.hoisted(() => ({
  getOnboardingPlugins: vi.fn(),
  applyOnboardingPlugins: vi.fn(),
}));
vi.mock("@/api/plugins-api", () => api);

const loader = vi.hoisted(() => ({ syncPlugins: vi.fn(async () => {}) }));
vi.mock("@/plugin-host/loader", () => loader);

import { PluginsStep } from "@/onboarding/steps/PluginsStep";
import { defaultChoices } from "@/onboarding/plugin-choices";

function plugin(
  id: string,
  extra: Partial<OnboardingPluginList["plugins"][number]> = {},
) {
  return {
    id,
    name: id.toUpperCase(),
    description: `${id} plugin`,
    icon: null,
    category: "Terminal",
    version: "1.0.0",
    source: "bundled" as const,
    state: "enabled",
    dependencies: [],
    recommended: false,
    consent: false,
    ...extra,
  };
}

const LIST: OnboardingPluginList = {
  pending: true,
  reason: "fresh",
  managedByLinkedServer: false,
  plugins: [
    plugin("term", { recommended: true }),
    plugin("base", { category: "Infrastructure" }),
    plugin("addon", { category: "Infrastructure", dependencies: ["base"] }),
    plugin("stats", { recommended: true, consent: true, state: "disabled" }),
  ],
};

describe("defaultChoices", () => {
  it("keeps recommended plugins and removes the rest on a fresh install", () => {
    expect(defaultChoices(LIST)).toEqual({
      term: "enabled",
      base: "remove",
      addon: "remove",
      stats: "enabled",
    });
  });

  it("starts from how things are now on an upgraded install", () => {
    expect(defaultChoices({ ...LIST, reason: "upgrade" })).toEqual({
      term: "enabled",
      base: "enabled",
      addon: "enabled",
      stats: "disabled",
    });
  });

  it("starts from how things are now on a later run", () => {
    expect(defaultChoices({ ...LIST, pending: false })).toEqual({
      term: "enabled",
      base: "enabled",
      addon: "enabled",
      stats: "disabled",
    });
  });
});

describe("PluginsStep", () => {
  let beforeNext: (() => boolean | Promise<boolean>) | null = null;

  beforeEach(() => {
    beforeNext = null;
    api.getOnboardingPlugins.mockResolvedValue(LIST);
    api.applyOnboardingPlugins.mockReset();
    loader.syncPlugins.mockClear();
  });

  async function renderStep() {
    render(
      <PluginsStep
        mode="full"
        isAdmin
        isDesktop={false}
        shellReady={false}
        setCanContinue={() => {}}
        setBeforeNext={(fn) => {
          beforeNext = fn;
        }}
      />,
    );
    await screen.findByText("TERM");
    // findByText resolves on the DOM change, before the effect that hands
    // over the loaded apply has run. Flush it so beforeNext is never stale.
    await act(async () => {});
  }

  it("groups plugins by category and puts consent plugins in their own section", async () => {
    await renderStep();
    expect(screen.getByText("Terminal")).toBeTruthy();
    expect(screen.getByText("Infrastructure")).toBeTruthy();
    expect(screen.getByRole("checkbox")).toHaveProperty("checked", true);
  });

  it("tells an upgrading admin that nothing changes unless they say so", async () => {
    api.getOnboardingPlugins.mockResolvedValue({ ...LIST, reason: "upgrade" });
    await renderStep();
    expect(screen.getByText(/onboarding.pluginsUpgradeNote/)).toBeTruthy();
  });

  it("keeps a dependency the admin kept something for, and says why", async () => {
    await renderStep();
    const addon = screen.getByRole("radiogroup", { name: "ADDON" });
    fireEvent.click(within(addon).getByRole("radio", { name: /enabled|On/ }));
    expect(
      await screen.findByText("onboarding.pluginsKeptBecause"),
    ).toBeTruthy();
    const base = screen.getByRole("radiogroup", { name: "BASE" });
    expect(
      within(base)
        .getByRole("radio", { name: /enabled|On/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("applies the choices on Next and resyncs the plugin runtime", async () => {
    api.applyOnboardingPlugins.mockResolvedValue({
      resolved: {},
      adjustments: [],
      enabled: [],
      disabled: [],
      removed: ["base", "addon"],
      failed: [],
    });
    api.getOnboardingPlugins.mockResolvedValueOnce(LIST).mockResolvedValue({
      ...LIST,
      pending: false,
    });
    await renderStep();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await beforeNext!();
    });
    expect(ok).toBe(true);
    expect(api.applyOnboardingPlugins).toHaveBeenCalledWith({
      term: "enabled",
      base: "remove",
      addon: "remove",
      stats: "enabled",
    });
    expect(loader.syncPlugins).toHaveBeenCalled();
  });

  it("stops once to show failures, then lets the admin move on", async () => {
    api.applyOnboardingPlugins.mockResolvedValue({
      resolved: {},
      adjustments: [],
      enabled: [],
      disabled: [],
      removed: [],
      failed: [{ id: "base", error: "busy" }],
    });
    api.getOnboardingPlugins.mockResolvedValueOnce(LIST).mockResolvedValue({
      ...LIST,
      pending: false,
    });
    await renderStep();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await beforeNext!();
    });
    expect(ok).toBe(false);
    expect(screen.getByText("BASE: busy")).toBeTruthy();
    await act(async () => {
      ok = await beforeNext!();
    });
    expect(ok).toBe(true);
    expect(api.applyOnboardingPlugins).toHaveBeenCalledTimes(1);
  });
});
