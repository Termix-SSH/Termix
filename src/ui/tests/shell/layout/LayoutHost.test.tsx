import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/main-axios", () => ({
  getUserInfo: vi.fn(async () => ({ is_admin: false })),
  getUserPreferences: vi.fn(async () => ({ reopenTabsOnLogin: false })),
  saveUserPreferences: vi.fn(async () => {}),
  getSSHHosts: vi.fn(async () => []),
  getSSHFolders: vi.fn(async () => []),
  getOpenTabs: vi.fn(async () => []),
  getActiveSessions: vi.fn(async () => []),
  addOpenTab: vi.fn(async () => {}),
  deleteOpenTab: vi.fn(async () => {}),
  patchOpenTab: vi.fn(async () => {}),
  createSSHHost: vi.fn(async () => ({})),
}));

const lookApi = vi.hoisted(() => ({
  getLook: vi.fn(),
  saveUserLook: vi.fn(async () => {}),
  saveDefaultLook: vi.fn(),
}));
vi.mock("@/api/look-api", () => lookApi);

const loader = vi.hoisted(() => ({
  retryPluginFrontend: vi.fn(async () => {}),
  syncPlugins: vi.fn(async () => {}),
}));
vi.mock("@/plugin-host/loader", () => loader);

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

vi.mock("@/look/RepairView", () => ({
  RepairView: ({
    status,
    onRetry,
  }: {
    status: { reason: string; error?: string | null };
    onRetry: () => void;
  }) => (
    <div data-testid="repair" data-reason={status.reason}>
      {status.error}
      <button type="button" onClick={onRetry}>
        retry
      </button>
    </div>
  ),
}));

import { LayoutHost } from "@/shell/layout/LayoutHost";
import { registerLayout, resetRegisteredLayouts } from "@/look/layout-registry";
import { chooseLayout, loadLook, resetLook } from "@/look/look-store";
import {
  ShellControllerProvider,
  useShellController,
} from "@/shell/controller/ShellControllerProvider";
import type { ShellController } from "@/shell/controller/types";
import { registerTabType, resetTabTypes } from "@/shell/tab-registry";
import {
  markPluginsSettled,
  resetPluginStore,
  setFrontendState,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import type { PluginSummary } from "@/api/plugins-api";

function lookFor(layoutId: string, safeLayout = false) {
  return {
    layoutId,
    themeId: null,
    defaults: { layout: null, theme: null },
    defaultLook: { layout: null, theme: null },
    safeLayout,
    unavailable: [] as unknown[],
  };
}

function plugin(patch: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: "fancy-layout",
    name: "Fancy",
    version: "1.0.0",
    enabled: true,
    state: "active",
    frontend: true,
    contributes: { layouts: [{ id: "fancy", label: "Fancy" }] },
    ...patch,
  };
}

async function start(
  layoutId: string,
  summaries: PluginSummary[] = [],
  safe = false,
) {
  lookApi.getLook.mockResolvedValue(lookFor(layoutId, safe));
  await loadLook();
  setPluginSummaries(summaries);
  markPluginsSettled();
}

beforeEach(() => {
  resetLook();
  resetPluginStore();
  resetRegisteredLayouts();
  mobile.value = false;
  loader.retryPluginFrontend.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("LayoutHost", () => {
  it("draws the chosen layout", async () => {
    registerLayout({ id: "fancy", component: () => <p>fancy layout</p> });
    await start("fancy");
    render(<LayoutHost />);
    expect(await screen.findByText("fancy layout")).toBeTruthy();
  });

  it("draws the mobile component on a phone", async () => {
    mobile.value = true;
    registerLayout({
      id: "fancy",
      component: () => <p>desktop</p>,
      mobileComponent: () => <p>phone</p>,
    });
    await start("fancy");
    render(<LayoutHost />);
    expect(await screen.findByText("phone")).toBeTruthy();
  });

  it("remounts after one crash and repairs after the second", async () => {
    // React retries a failed render once by itself before a boundary sees it.
    let throwsLeft = 2;
    function Flaky() {
      if (throwsLeft > 0) {
        throwsLeft -= 1;
        throw new Error("draw failed");
      }
      return <p>recovered</p>;
    }
    // React reports the crash it recovered from; that report is expected.
    const expected = (event: ErrorEvent) => {
      if (String(event.error?.cause ?? event.message).includes("draw failed"))
        event.preventDefault();
    };
    window.addEventListener("error", expected);
    registerLayout({ id: "fancy", component: Flaky });
    await start("fancy");
    render(<LayoutHost />);
    expect(await screen.findByText("recovered")).toBeTruthy();
    window.removeEventListener("error", expected);

    cleanup();
    resetRegisteredLayouts();
    function Broken(): never {
      throw new Error("always broken");
    }
    registerLayout({ id: "fancy", component: Broken });
    render(<LayoutHost />);
    const repair = await screen.findByTestId("repair");
    expect(repair.dataset.reason).toBe("crashed");
    expect(repair.textContent).toContain("always broken");
  });

  it("repairs with ?safe-layout=1 even when the layout works", async () => {
    window.history.replaceState(null, "", "/?safe-layout=1");
    registerLayout({ id: "fancy", component: () => <p>fancy layout</p> });
    await start("fancy");
    render(<LayoutHost />);
    expect((await screen.findByTestId("repair")).dataset.reason).toBe(
      "safe-url",
    );
  });

  it("repairs when the server sets TERMIX_SAFE_LAYOUT", async () => {
    registerLayout({ id: "fancy", component: () => <p>fancy layout</p> });
    await start("fancy", [], true);
    render(<LayoutHost />);
    expect((await screen.findByTestId("repair")).dataset.reason).toBe(
      "safe-env",
    );
  });

  it("repairs a missing layout", async () => {
    await start("ghost");
    render(<LayoutHost />);
    expect((await screen.findByTestId("repair")).dataset.reason).toBe(
      "missing",
    );
  });

  it("repairs a layout whose plugin is disabled", async () => {
    await start("fancy", [plugin({ enabled: false, state: "disabled" })]);
    render(<LayoutHost />);
    expect((await screen.findByTestId("repair")).dataset.reason).toBe(
      "disabled",
    );
  });

  it("repairs a layout that throws on activate, and retries it", async () => {
    await start("fancy", [plugin()]);
    setFrontendState("fancy-layout", "failed", "activate threw");
    render(<LayoutHost />);
    const repair = await screen.findByTestId("repair");
    expect(repair.dataset.reason).toBe("failed");
    expect(repair.textContent).toContain("activate threw");
    screen.getByText("retry").click();
    await waitFor(() =>
      expect(loader.retryPluginFrontend).toHaveBeenCalledWith("fancy-layout"),
    );
  });

  it("closes the tabs the old layout plugin brought when the layout changes", async () => {
    registerLayout({ id: "fancy", component: () => <p>fancy layout</p> });
    registerLayout({ id: "plain", component: () => <p>plain layout</p> });
    registerTabType({
      id: "fancy-settings",
      component: () => null,
      hostless: true,
      singleton: true,
    });
    registerTabType({
      id: "notes",
      component: () => null,
      hostless: true,
      multiInstance: true,
    });
    await start("fancy", [
      plugin({
        contributes: {
          layouts: [{ id: "fancy", label: "Fancy" }],
          tabs: [
            {
              id: "fancy-settings",
              titleKey: "x",
              icon: "Settings",
              openFrom: [],
            },
          ],
        },
      }),
      plugin({
        id: "plain-layout",
        contributes: { layouts: [{ id: "plain", label: "Plain" }] },
      }),
    ]);
    let shell: ShellController | null = null;
    function Capture() {
      shell = useShellController();
      return null;
    }
    render(
      <ShellControllerProvider username="ada" onLogout={() => {}}>
        <Capture />
        <LayoutHost />
      </ShellControllerProvider>,
    );
    await screen.findByText("fancy layout");
    act(() => {
      shell!.tabs.openSingleton("fancy-settings");
      shell!.tabs.openMultiInstance("notes");
    });
    const types = () => shell!.tabs.list.map((tab) => tab.type).sort();
    await waitFor(() =>
      expect(types()).toEqual(["dashboard", "fancy-settings", "notes"]),
    );

    await act(() => chooseLayout("plain"));
    await screen.findByText("plain layout");
    await waitFor(() => expect(types()).toEqual(["dashboard", "notes"]));
    resetTabTypes();
  });
});
