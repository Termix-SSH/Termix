import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      (options?.defaultValue as string | undefined) ?? key,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const permissions = vi.hoisted(() => ({ isAdmin: false }));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    isAdmin: permissions.isAdmin,
    permissions: [],
    loaded: true,
    has: () => permissions.isAdmin,
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const look = vi.hoisted(() => ({
  chooseLayout: vi.fn(async () => {}),
  loadLook: vi.fn(async () => null),
  state: {
    loaded: true,
    response: {
      layoutId: null as string | null,
      themeId: null,
      defaults: { layout: null, theme: null },
      defaultLook: { layout: "classic", theme: "dark" },
      safeLayout: false,
      unavailable: [],
    },
  },
}));
vi.mock("@/look/look-store", () => ({
  chooseLayout: look.chooseLayout,
  loadLook: look.loadLook,
  useLookState: () => look.state,
}));

vi.mock("@/plugin-host/plugin-store", () => ({
  usePluginStore: () => ({
    loaded: true,
    settled: true,
    records: new Map([
      [
        "classic-pack",
        { summary: { id: "classic-pack", videoId: "abcdefghijk" } },
      ],
    ]),
  }),
}));

vi.mock("@/plugins/PluginConsentPrompt", () => ({
  PluginConsentPrompt: () => null,
}));

const manager = vi.hoisted(() => ({
  requestInstall: vi.fn(),
  toggle: vi.fn(async () => {}),
  confirmConsent: vi.fn(),
  cancelConsent: vi.fn(),
}));
const entry = (over: Record<string, unknown>) => ({
  installed: false,
  enabled: false,
  managedByServer: false,
  unsupported: false,
  registryId: "official",
  kinds: ["layouts"],
  versions: [],
  ...over,
});
vi.mock("@/plugins/use-plugins-manager", () => ({
  usePluginsManager: () => ({
    ...manager,
    loading: false,
    registryError: null,
    consent: null,
    busy: new Set<string>(),
    plugins: [
      entry({ id: "grid-layout", name: "Grid", description: "Tiles" }),
      entry({ id: "old-layout", name: "Old", installed: true }),
      entry({ id: "running", name: "Running", installed: true, enabled: true }),
      entry({ id: "docker", name: "Docker", kinds: ["tabs"] }),
      entry({ id: "too-new", name: "Too new", unsupported: true }),
    ],
  }),
}));

import { LayoutStep } from "@/onboarding/steps/LayoutStep";
import { isLayoutOffer } from "@/plugins/plugin-model";
import { resetPluginLayouts, setPluginLayouts } from "@/look/layout-registry";

const props = {
  setCanContinue: () => {},
  setBeforeNext: () => {},
} as unknown as Parameters<typeof LayoutStep>[0];

describe("LayoutStep", () => {
  beforeEach(() => {
    permissions.isAdmin = false;
    look.state.response.layoutId = null;
    setPluginLayouts([
      { id: "classic", label: "Classic", pluginId: "classic-pack" },
      { id: "simple", label: "Simple", pluginId: "simple-pack" },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetPluginLayouts();
  });

  it("lists installed layouts and marks the one in use", () => {
    render(<LayoutStep {...props} />);
    const classic = screen.getByRole("button", { name: /Classic/ });
    expect(classic.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /Simple/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("shows the plugin's video thumbnail as the picture", () => {
    const { container } = render(<LayoutStep {...props} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg",
    );
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("switches layout on click", () => {
    render(<LayoutStep {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Simple/ }));
    expect(look.chooseLayout).toHaveBeenCalledWith("simple");
  });

  it("does nothing when the layout in use is clicked", () => {
    render(<LayoutStep {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Classic/ }));
    expect(look.chooseLayout).not.toHaveBeenCalled();
  });

  it("hides the registry from someone who is not an admin", () => {
    render(<LayoutStep {...props} />);
    expect(screen.queryByText("onboarding.layoutMore")).toBeNull();
    expect(screen.getByText("onboarding.layoutChangeLater")).toBeTruthy();
  });

  it("lets an admin install a layout or turn one on", () => {
    permissions.isAdmin = true;
    render(<LayoutStep {...props} />);
    expect(screen.getByText("onboarding.layoutMore")).toBeTruthy();
    expect(screen.getByText("onboarding.layoutChangeLaterAdmin")).toBeTruthy();
    expect(screen.getByText("Grid")).toBeTruthy();
    expect(screen.queryByText("Docker")).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("Too new")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /onboarding.layoutInstall/ }),
    );
    expect(manager.requestInstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: "grid-layout" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /onboarding.layoutTurnOn/ }),
    );
    expect(manager.toggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "old-layout" }),
    );
  });
});

describe("isLayoutOffer", () => {
  it("never offers a plugin a linked server decides on", () => {
    expect(
      isLayoutOffer(
        entry({ id: "x", managedByServer: true }) as unknown as Parameters<
          typeof isLayoutOffer
        >[0],
      ),
    ).toBe(false);
  });
});
