import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PluginSummary } from "@/api/plugins-api";

const api = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  getPluginAdminSettings: vi.fn(),
  getPluginUserSettings: vi.fn(),
  updatePluginAdminSettings: vi.fn(),
  updatePluginUserSettings: vi.fn(),
}));

vi.mock("@/api/plugins-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/plugins-api")>()),
  ...api,
}));

vi.mock("react-i18next", () => {
  const t = (key: string, options?: { name?: string }) =>
    options?.name ? `${key}:${options.name}` : key;
  return { useTranslation: () => ({ t }) };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  FeatureSettingsSection,
  useFeatureSettings,
} from "@/settings/FeatureSettingsSections";

function plugin(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: "ai",
    name: "AI Assistant",
    version: "1.0.0",
    enabled: true,
    state: "active",
    contributes: {
      settings: {
        admin: [{ key: "on", type: "boolean", labelKey: "admin.on" }],
        user: [{ key: "enabled", type: "boolean", labelKey: "user.enabled" }],
      },
    },
    ...overrides,
  } as PluginSummary;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("useFeatureSettings", () => {
  it("keeps enabled features with visible fields in the scope, sorted by name", async () => {
    api.getPlugins.mockResolvedValue([
      plugin({ id: "zeta", name: "Zeta" }),
      plugin({ id: "off", name: "Off", enabled: false }),
      plugin({
        id: "hidden",
        name: "Hidden",
        contributes: {
          settings: {
            user: [{ key: "x", type: "boolean", labelKey: "x", hidden: true }],
          },
        },
      }),
      plugin({ id: "alpha", name: "Alpha" }),
    ]);

    const { result } = renderHook(() => useFeatureSettings("user"));

    await waitFor(() =>
      expect(result.current.map((p) => p.id)).toEqual(["alpha", "zeta"]),
    );
  });

  it("leaves out features with nothing in the scope", async () => {
    api.getPlugins.mockResolvedValue([
      plugin({
        id: "admin-only",
        contributes: {
          settings: {
            admin: [{ key: "a", type: "boolean", labelKey: "a" }],
          },
        },
      }),
    ]);

    const { result } = renderHook(() => useFeatureSettings("user"));

    await waitFor(() => expect(api.getPlugins).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});

describe("FeatureSettingsSection", () => {
  it("is titled with the feature name and loads nothing while closed", () => {
    render(
      <FeatureSettingsSection
        plugin={plugin()}
        scope="user"
        open={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("AI Assistant")).toBeTruthy();
    expect(api.getPluginUserSettings).not.toHaveBeenCalled();
  });

  it("loads and saves the scope's values once open", async () => {
    api.getPluginUserSettings.mockResolvedValue({ enabled: false });
    api.updatePluginUserSettings.mockResolvedValue({ enabled: true });

    render(
      <FeatureSettingsSection
        plugin={plugin()}
        scope="user"
        open
        onToggle={vi.fn()}
      />,
    );

    await screen.findByText("ai:user.enabled");
    expect(api.getPluginUserSettings).toHaveBeenCalledWith("ai");
    expect(api.getPluginAdminSettings).not.toHaveBeenCalled();

    const save = screen.getByText("common.save").closest("button")!;
    expect(save.disabled).toBe(true);

    fireEvent.click(
      screen
        .getAllByRole("button")
        .find((b) => b !== save && b.textContent === "")!,
    );
    fireEvent.click(save);

    await waitFor(() =>
      expect(api.updatePluginUserSettings).toHaveBeenCalledWith("ai", {
        enabled: true,
      }),
    );
  });

  it("uses the admin endpoints for the admin scope", async () => {
    api.getPluginAdminSettings.mockResolvedValue({ on: true });

    render(
      <FeatureSettingsSection
        plugin={plugin()}
        scope="admin"
        open
        onToggle={vi.fn()}
      />,
    );

    await screen.findByText("ai:admin.on");
    expect(api.getPluginAdminSettings).toHaveBeenCalledWith("ai");
  });

  it("says when the feature is unavailable", async () => {
    api.getPluginUserSettings.mockResolvedValue({});

    render(
      <FeatureSettingsSection
        plugin={plugin({ state: "failed" })}
        scope="user"
        open
        onToggle={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("settings.featureUnavailable:AI Assistant"),
    ).toBeTruthy();
  });
});
