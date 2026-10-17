import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "termix-pending-view-link";

const mocks = vi.hoisted(() => ({
  rendered: null as ReactNode,
  isElectron: vi.fn(() => false),
  getStoredAuth: vi.fn(),
  getUserInfo: vi.fn(),
  fetchGuestViews: vi.fn(),
  startPluginRuntime: vi.fn(async () => {}),
  standaloneViewFor: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  createRoot: () => ({
    render: (node: ReactNode) => {
      mocks.rendered = node;
    },
  }),
}));
vi.mock("@/lib/client-cache-version", () => ({
  prepareClientCacheVersion: () => Promise.resolve(),
}));
vi.mock("@/i18n/i18n", () => ({}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/theme-provider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/contexts/BrandingContext", () => ({
  BrandingProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/contexts/UiPreferencesContext", () => ({
  UiPreferencesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/sonner", () => ({ Toaster: () => null }));
vi.mock("@/hooks/use-service-worker", () => ({ useServiceWorker: () => {} }));
vi.mock("@/lib/electron-wheel-zoom", () => ({
  installElectronWheelZoomGuard: () => {},
}));
vi.mock("@/lib/electron", () => ({ isElectron: mocks.isElectron }));
vi.mock("@/lib/embedded-server-status", () => ({
  getEmbeddedServerFailure: async () => null,
}));
vi.mock("@/auth/Auth", () => ({
  Auth: ({ onLogin }: { onLogin: (username: string) => void }) => (
    <button onClick={() => onLogin("alice")}>sign in</button>
  ),
  getStoredAuth: mocks.getStoredAuth,
  clearStoredAuth: vi.fn(),
  markDesktopManualLogout: vi.fn(),
  clearDesktopManualLogout: vi.fn(),
}));
vi.mock("@/main-axios", () => ({
  getUserInfo: mocks.getUserInfo,
  getCurrentToken: vi.fn(async () => null),
  appReadyPromise: Promise.resolve(),
}));
vi.mock("@/plugin-host/loader", () => ({
  fetchGuestViews: mocks.fetchGuestViews,
  startPluginRuntime: mocks.startPluginRuntime,
  stopPluginRuntime: vi.fn(async () => {}),
}));
vi.mock("@/plugin-host/plugin-store", () => ({
  settledPromise: async () => {},
}));
vi.mock("@/plugin-host/shell-bridge", () => ({ resetShellBridge: vi.fn() }));
vi.mock("@/hooks/use-permissions", () => ({
  preloadPermissions: async () => {},
}));
vi.mock("@/api/open-tabs-api", () => ({
  getUserPreferences: async () => undefined,
}));
vi.mock("@/shell/tab-registry", () => ({
  standaloneViewFor: mocks.standaloneViewFor,
}));
vi.mock("@/plugin-host/PluginViewPlaceholder", () => ({
  PluginViewPlaceholder: ({ viewId }: { viewId: string }) => (
    <div>placeholder:{viewId}</div>
  ),
}));
vi.mock("@/onboarding/startup", () => ({
  resolveStartupOnboarding: async () => null,
}));
vi.mock("@/AppShell", () => ({ AppShell: () => <div>app shell</div> }));
vi.mock("@/onboarding/OnboardingStage", () => ({
  OnboardingStage: () => null,
}));

const originalLocation = window.location;
let replace: ReturnType<typeof vi.fn>;

/** Loads the entry point fresh, the way a page load would. */
async function openPage(url: string) {
  window.history.replaceState({}, "", url);
  vi.resetModules();
  mocks.rendered = null;
  await import("../../main");
  await vi.waitFor(() => expect(mocks.rendered).not.toBeNull());
  render(<>{mocks.rendered}</>);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  mocks.isElectron.mockReturnValue(false);
  mocks.getStoredAuth.mockReturnValue(null);
  mocks.getUserInfo.mockRejectedValue({ status: 401 });
  mocks.fetchGuestViews.mockResolvedValue(["example-plugin.guest"]);
  mocks.standaloneViewFor.mockImplementation((view: string) => ({
    standalone: () => <div>standalone:{view}</div>,
  }));
  replace = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get origin() {
        return originalLocation.origin;
      },
      get pathname() {
        return originalLocation.pathname;
      },
      get search() {
        return originalLocation.search;
      },
      get hash() {
        return originalLocation.hash;
      },
      replace,
    },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("full-screen view links", () => {
  it("shows the login when signed out and returns to the link after it", async () => {
    await openPage("/?view=example-plugin.request&request=123");

    const signIn = await screen.findByText("sign in");
    expect(sessionStorage.getItem(KEY)).toBe(
      "/?view=example-plugin.request&request=123",
    );
    fireEvent.click(signIn);

    await vi.waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "/?view=example-plugin.request&request=123",
      ),
    );
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("keeps the bare view in the desktop app", async () => {
    mocks.isElectron.mockReturnValue(true);
    mocks.standaloneViewFor.mockReturnValue(undefined);
    await openPage("/?view=example-plugin.request");

    expect(
      await screen.findByText("placeholder:example-plugin.request"),
    ).toBeTruthy();
    expect(screen.queryByText("sign in")).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("serves a guest view without a session or a login", async () => {
    await openPage("/?view=example-plugin.guest&room=1");

    expect(
      await screen.findByText("standalone:example-plugin.guest"),
    ).toBeTruthy();
    expect(mocks.getUserInfo).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
