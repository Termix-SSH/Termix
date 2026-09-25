/**
 * The one Settings screen.
 *
 * What matters here is the navigation: which bands appear for whom, that a
 * plugin's page shows up only when it has settings that user could change, and
 * that the nav collapses rather than disappearing on a phone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { PluginSummary } from "@/api/plugins-api";

const { getPluginsMock } = vi.hoisted(() => ({ getPluginsMock: vi.fn() }));

vi.mock("@/api/plugins-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/plugins-api")>()),
  getPlugins: getPluginsMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The two core panels are large and pull in most of the app; this screen only
// has to decide which one to mount.
vi.mock("@/sidebar/UserProfilePanel", () => ({
  UserProfilePanel: () => <div>profile-panel</div>,
}));
vi.mock("@/sidebar/AdminSettingsPanel", () => ({
  AdminSettingsPanel: () => <div>admin-panel</div>,
}));

const { SettingsScreen } = await import("@/settings/SettingsScreen");

function plugin(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: "tailscale",
    name: "Tailscale",
    version: "1.0.0",
    enabled: true,
    state: "active",
    contributes: {
      settings: { admin: [{ key: "apiKey", type: "secret", labelKey: "k" }] },
    },
    ...overrides,
  } as PluginSummary;
}

beforeEach(() => {
  getPluginsMock.mockReset();
  getPluginsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("navigation bands", () => {
  it("always shows the You band", async () => {
    render(<SettingsScreen />);

    expect(await screen.findByText("settings.bandYou")).toBeTruthy();
  });

  it("shows the Instance band only to an admin", async () => {
    const { unmount } = render(<SettingsScreen isAdmin={false} />);
    await waitFor(() => expect(getPluginsMock).toHaveBeenCalled());
    expect(screen.queryByText("settings.bandInstance")).toBeNull();
    unmount();

    render(<SettingsScreen isAdmin />);
    expect(await screen.findByText("settings.bandInstance")).toBeTruthy();
  });

  it("shows no Plugins band when nothing declares settings", async () => {
    render(<SettingsScreen isAdmin />);
    await waitFor(() => expect(getPluginsMock).toHaveBeenCalled());

    expect(screen.queryByText("settings.bandPlugins")).toBeNull();
  });

  it("lists a plugin with admin settings for an admin", async () => {
    getPluginsMock.mockResolvedValue([plugin()]);

    render(<SettingsScreen isAdmin />);

    expect(await screen.findByText("settings.bandPlugins")).toBeTruthy();
    expect(screen.getByText("Tailscale")).toBeTruthy();
  });

  it("hides an admin-only plugin page from a non-admin", async () => {
    getPluginsMock.mockResolvedValue([plugin()]);

    render(<SettingsScreen isAdmin={false} />);
    await waitFor(() => expect(getPluginsMock).toHaveBeenCalled());

    expect(screen.queryByText("Tailscale")).toBeNull();
  });

  it("shows a plugin with user settings to everyone", async () => {
    getPluginsMock.mockResolvedValue([
      plugin({
        contributes: {
          settings: { user: [{ key: "theme", type: "string", labelKey: "k" }] },
        },
      }),
    ]);

    render(<SettingsScreen isAdmin={false} />);

    expect(await screen.findByText("Tailscale")).toBeTruthy();
  });

  it("hides a disabled plugin's page", async () => {
    getPluginsMock.mockResolvedValue([plugin({ enabled: false })]);

    render(<SettingsScreen isAdmin />);
    await waitFor(() => expect(getPluginsMock).toHaveBeenCalled());

    expect(screen.queryByText("Tailscale")).toBeNull();
  });

  it("keeps working when the plugin list cannot be loaded", async () => {
    getPluginsMock.mockRejectedValue(new Error("offline"));

    render(<SettingsScreen isAdmin />);

    expect(await screen.findByText("settings.bandYou")).toBeTruthy();
  });
});

describe("initial section", () => {
  it("lands on the profile panel by default", async () => {
    render(<SettingsScreen />);

    expect(await screen.findByText("profile-panel")).toBeTruthy();
  });

  it("lands on the admin panel when opened from the admin rail entry", async () => {
    render(<SettingsScreen isAdmin initialSection="admin" />);

    expect(await screen.findByText("admin-panel")).toBeTruthy();
  });

  it("does not mount the admin panel for a non-admin", async () => {
    render(<SettingsScreen isAdmin={false} initialSection="admin" />);
    await waitFor(() => expect(getPluginsMock).toHaveBeenCalled());

    expect(screen.queryByText("admin-panel")).toBeNull();
  });

  it("switches section when the rail entry changes", async () => {
    const { rerender } = render(
      <SettingsScreen isAdmin initialSection="profile" />,
    );
    expect(await screen.findByText("profile-panel")).toBeTruthy();

    rerender(<SettingsScreen isAdmin initialSection="admin" />);

    expect(await screen.findByText("admin-panel")).toBeTruthy();
  });
});

describe("phone layout", () => {
  it("offers a disclosure button for the collapsed nav", async () => {
    render(<SettingsScreen />);
    await screen.findByText("settings.bandYou");

    const toggle = document.querySelector("button[aria-expanded]");
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });

  it("hides the nav below md and shows it from md up", async () => {
    render(<SettingsScreen />);
    await screen.findByText("settings.bandYou");

    const nav = document.querySelector("nav")!;
    expect(nav.className).toContain("hidden");
    expect(nav.className).toContain("md:flex");
  });
});
