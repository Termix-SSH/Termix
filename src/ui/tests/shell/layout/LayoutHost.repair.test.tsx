import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

// The repair drill: a broken layout, the real repair view, the real look
// store. Only the server, the plugin loader and the Plugins tab flows are fakes.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options === "object" && !("defaultValue" in options)
        ? `${key}:${JSON.stringify(options)}`
        : ((options?.defaultValue as string | undefined) ?? key),
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const permissions = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    isAdmin: permissions.isAdmin,
    permissions: [],
    loaded: true,
    has: () => permissions.isAdmin,
  }),
}));

const lookApi = vi.hoisted(() => ({
  getLook: vi.fn(),
  saveUserLook: vi.fn(async (_patch: Record<string, unknown>) => {}),
  saveDefaultLook: vi.fn(async (defaults: Record<string, unknown>) => ({
    layout: null,
    theme: null,
    ...defaults,
  })),
}));
vi.mock("@/api/look-api", () => lookApi);

const loader = vi.hoisted(() => ({
  retryPluginFrontend: vi.fn(async () => {}),
  syncPlugins: vi.fn(async () => {}),
}));
vi.mock("@/plugin-host/loader", () => loader);
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const manager = vi.hoisted(() => ({
  requestUpdate: vi.fn(),
  requestInstall: vi.fn(),
  toggle: vi.fn(),
  setConsent: vi.fn(),
  confirmConsent: vi.fn(),
}));
vi.mock("@/plugins/use-plugins-manager", () => ({
  usePluginsManager: () => ({
    ...manager,
    loading: false,
    registryError: null,
    consent: null,
    busy: new Set<string>(),
    plugins: [
      {
        id: "fancy-layout",
        name: "Fancy",
        installed: true,
        enabled: true,
        updateAvailable: true,
        latestVersion: "1.1.0",
        managedByServer: false,
        bundled: false,
        versions: [],
      },
      {
        id: "paper-themes",
        name: "Paper themes",
        description: "Light themes",
        installed: false,
        enabled: false,
        updateAvailable: false,
        latestVersion: "1.0.0",
        versions: [{ version: "1.0.0", capabilities: ["ui:theme"] }],
      },
    ],
  }),
}));

import { LayoutHost } from "@/shell/layout/LayoutHost";
import {
  registerLayout,
  resetRegisteredLayouts,
  setPluginLayouts,
} from "@/look/layout-registry";
import { loadLook, resetLook } from "@/look/look-store";
import {
  markPluginsSettled,
  resetPluginStore,
  setFrontendState,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import type { PluginSummary } from "@/api/plugins-api";

const fancyPlugin: PluginSummary = {
  id: "fancy-layout",
  name: "Fancy",
  version: "1.0.0",
  enabled: true,
  state: "active",
  frontend: true,
  contributes: { layouts: [{ id: "fancy", label: "Fancy" }] },
};

async function start(look: {
  layoutId?: string | null;
  defaultLayout?: string | null;
  summaries?: PluginSummary[];
}) {
  lookApi.getLook.mockResolvedValue({
    layoutId: look.layoutId ?? null,
    themeId: null,
    defaults: { layout: look.defaultLayout ?? null, theme: null },
    defaultLook: { layout: "classic", theme: "dark" },
    safeLayout: false,
    unavailable: [],
  });
  await loadLook();
  setPluginSummaries(look.summaries ?? []);
  markPluginsSettled();
}

function Broken(): never {
  throw new Error("draw exploded");
}
// React reports crashes it caught; these are expected here.
const expectedCrash = (event: ErrorEvent) => event.preventDefault();

beforeEach(() => {
  permissions.isAdmin = true;
  resetLook();
  resetPluginStore();
  resetRegisteredLayouts();
  for (const fn of [
    ...Object.values(manager),
    lookApi.saveUserLook,
    lookApi.saveDefaultLook,
  ]) {
    fn.mockClear();
  }
  setPluginLayouts([
    { id: "fancy", label: "Fancy", pluginId: "fancy-layout" },
    { id: "classic", label: "Classic", pluginId: "classic-layout" },
  ]);
  registerLayout({ id: "classic", component: () => <p>classic layout</p> });
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.addEventListener("error", expectedCrash);
});

afterEach(() => {
  cleanup();
  window.removeEventListener("error", expectedCrash);
  vi.restoreAllMocks();
});

describe("layout repair drill", () => {
  it("a layout that throws while drawing ends in the repair view, and switching gets out", async () => {
    registerLayout({ id: "fancy", component: Broken });
    await start({ layoutId: "fancy", summaries: [fancyPlugin] });
    render(<LayoutHost />);

    expect(await screen.findByText("draw exploded")).toBeTruthy();
    fireEvent.click(screen.getByText("Classic"));
    await waitFor(() =>
      expect(lookApi.saveUserLook).toHaveBeenCalledWith({
        layoutId: "classic",
      }),
    );
    expect(await screen.findByText("classic layout")).toBeTruthy();
  });

  it("a layout whose activate threw shows the error, and reset brings the default look back", async () => {
    await start({ layoutId: "fancy", summaries: [fancyPlugin] });
    setFrontendState("fancy-layout", "failed", "activate exploded");
    render(<LayoutHost />);

    expect(await screen.findByText("activate exploded")).toBeTruthy();
    fireEvent.click(screen.getByText("looks.repair.reset"));
    await waitFor(() =>
      expect(lookApi.saveUserLook).toHaveBeenCalledWith({ layoutId: null }),
    );
    expect(lookApi.saveUserLook).toHaveBeenCalledWith({ themeId: null });
    expect(await screen.findByText("classic layout")).toBeTruthy();
  });

  it("an admin updates the broken plugin when the registry has a newer one", async () => {
    await start({ layoutId: "fancy", summaries: [fancyPlugin] });
    setFrontendState("fancy-layout", "failed", "activate exploded");
    render(<LayoutHost />);

    fireEvent.click(await screen.findByText(/looks\.repair\.update/));
    expect(manager.requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fancy-layout" }),
    );
  });

  it("an admin installs a layout or theme from the registries", async () => {
    await start({ layoutId: "fancy", summaries: [fancyPlugin] });
    setFrontendState("fancy-layout", "failed", "activate exploded");
    render(<LayoutHost />);

    fireEvent.click(await screen.findByText("looks.repair.install"));
    expect(await screen.findByText("Paper themes")).toBeTruthy();
    fireEvent.click(screen.getByText("looks.repair.installButton"));
    expect(manager.requestInstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: "paper-themes" }),
    );
  });

  it("someone who is not an admin gets switch and reset, and a note to ask an admin", async () => {
    permissions.isAdmin = false;
    await start({ layoutId: "fancy", summaries: [fancyPlugin] });
    setFrontendState("fancy-layout", "failed", "activate exploded");
    render(<LayoutHost />);

    expect(await screen.findByText("looks.repair.askAdmin")).toBeTruthy();
    expect(screen.queryByText(/looks\.repair\.update/)).toBeNull();
    expect(screen.queryByText("looks.repair.install")).toBeNull();
    expect(screen.getByText("looks.repair.reset")).toBeTruthy();
    expect(screen.getByText("Classic")).toBeTruthy();
  });

  it("the user's own layout wins over the admin default", async () => {
    registerLayout({ id: "fancy", component: () => <p>fancy layout</p> });
    await start({
      layoutId: "fancy",
      defaultLayout: "classic",
      summaries: [fancyPlugin],
    });
    render(<LayoutHost />);
    expect(await screen.findByText("fancy layout")).toBeTruthy();
  });

  it("a layout the server dropped as uninstalled falls back to the admin default", async () => {
    // The server answers null for a choice no installed plugin brings.
    registerLayout({ id: "fancy", component: () => <p>fancy layout</p> });
    await start({ layoutId: null, defaultLayout: "fancy" });
    render(<LayoutHost />);
    expect(await screen.findByText("fancy layout")).toBeTruthy();

    cleanup();
    resetLook();
    await start({ layoutId: null, defaultLayout: null });
    render(<LayoutHost />);
    expect(await screen.findByText("classic layout")).toBeTruthy();
  });

  it("?safe-layout=1 opens the repair view over a working layout, and leaving it draws the layout", async () => {
    window.history.replaceState(null, "", "/?safe-layout=1");
    await start({ layoutId: "classic" });
    render(<LayoutHost />);
    expect(await screen.findByText("looks.repair.safeTitle")).toBeTruthy();
    expect(screen.queryByText("looks.repair.retry")).toBeNull();

    cleanup();
    window.history.replaceState(null, "", "/");
    render(<LayoutHost />);
    expect(await screen.findByText("classic layout")).toBeTruthy();
  });

  it("TERMIX_SAFE_LAYOUT on the server opens the repair view for everyone", async () => {
    lookApi.getLook.mockResolvedValue({
      layoutId: "classic",
      themeId: null,
      defaults: { layout: null, theme: null },
      defaultLook: { layout: "classic", theme: "dark" },
      safeLayout: true,
      unavailable: [],
    });
    await act(async () => {
      await loadLook();
    });
    setPluginSummaries([]);
    markPluginsSettled();
    render(<LayoutHost />);
    expect(await screen.findByText("looks.repair.safeTitle")).toBeTruthy();
  });
});
