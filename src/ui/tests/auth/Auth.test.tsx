import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mainAxios = vi.hoisted(() => ({
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  getUserInfo: vi.fn(),
  getRegistrationAllowed: vi.fn(),
  getPasswordLoginAllowed: vi.fn(),
  getPasswordResetAllowed: vi.fn(),
  getSetupRequired: vi.fn(),
  initiatePasswordReset: vi.fn(),
  verifyPasswordResetCode: vi.fn(),
  completePasswordReset: vi.fn(),
  getOIDCAuthorizeUrl: vi.fn(),
  verifyTOTPLogin: vi.fn(),
  isElectron: vi.fn(),
  getCurrentToken: vi.fn(),
  getOidcSilentLoginDefault: vi.fn(),
  requestDesktopAutoSession: vi.fn(),
}));

const ssoProviderApi = vi.hoisted(() => ({
  getSSOProviders: vi.fn(),
  ldapLogin: vi.fn(),
}));

vi.mock("@/main-axios", () => mainAxios);
vi.mock("@/api/sso-provider-api", () => ssoProviderApi);
vi.mock("@/i18n/i18n", () => ({
  changeAppLanguage: vi.fn(async (code: string) => code),
  normalizeLanguageCode: vi.fn((code: string | null) => code || "en"),
}));
vi.mock("../../auth/silent-signin", () => ({
  removeSilentSigninFromSearch: vi.fn(),
  shouldTriggerSilentSignin: vi.fn(() => false),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      opts?: string | { defaultValue?: string } | Record<string, unknown>,
    ) => {
      if (typeof opts === "string") return opts;
      if (opts && "defaultValue" in opts && opts.defaultValue) {
        return String(opts.defaultValue);
      }
      return key;
    },
  }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

import { Auth } from "../../auth/Auth";

declare global {
  interface Window {
    IS_ELECTRON_WEBVIEW?: boolean;
  }
}

const OriginalResizeObserver = globalThis.ResizeObserver;

function renderAuth() {
  return render(<Auth onLogin={vi.fn()} />);
}

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  localStorage.clear();
  delete window.IS_ELECTRON_WEBVIEW;
  mainAxios.isElectron.mockReturnValue(false);
  mainAxios.getRegistrationAllowed.mockResolvedValue({ allowed: true });
  mainAxios.getPasswordLoginAllowed.mockResolvedValue({ allowed: true });
  mainAxios.getPasswordResetAllowed.mockResolvedValue(true);
  mainAxios.getSetupRequired.mockResolvedValue({ setup_required: false });
  mainAxios.getOidcSilentLoginDefault.mockResolvedValue({ enabled: false });
  mainAxios.requestDesktopAutoSession.mockResolvedValue({ kind: "declined" });
  ssoProviderApi.getSSOProviders.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterAll(() => {
  globalThis.ResizeObserver = OriginalResizeObserver;
});

describe("Auth local desktop flow", () => {
  it("shows only a local continue panel after manual desktop logout", async () => {
    mainAxios.isElectron.mockReturnValue(true);
    localStorage.setItem("termix_desktop_manual_logout", "true");

    renderAuth();

    await waitFor(() => {
      expect(screen.getByText("Local desktop signed out")).toBeTruthy();
    });
    expect(screen.getByText("Continue with local desktop")).toBeTruthy();
    expect(screen.queryByText("common.register")).toBeNull();
    expect(screen.queryByLabelText("common.username")).toBeNull();
    expect(screen.queryByText("auth.forgotPassword")).toBeNull();
    expect(mainAxios.getSetupRequired).not.toHaveBeenCalled();
  });

  it("shows local recovery instead of register when auto-session is declined", async () => {
    mainAxios.isElectron.mockReturnValue(true);
    mainAxios.requestDesktopAutoSession.mockResolvedValue({ kind: "declined" });

    renderAuth();

    await waitFor(() => {
      expect(
        screen.getByText("Local desktop session unavailable"),
      ).toBeTruthy();
    });
    expect(screen.getByText("Retry local desktop session")).toBeTruthy();
    expect(screen.queryByText("common.register")).toBeNull();
    expect(screen.queryByLabelText("common.username")).toBeNull();
    expect(mainAxios.requestDesktopAutoSession).toHaveBeenCalled();
    expect(mainAxios.getSetupRequired).not.toHaveBeenCalled();
  });

  it("keeps register visible for normal web auth when registration is allowed", async () => {
    mainAxios.isElectron.mockReturnValue(false);

    renderAuth();

    await waitFor(() => {
      expect(screen.getAllByText("common.register").length).toBeGreaterThan(0);
    });
    expect(screen.getByLabelText("common.username")).toBeTruthy();
  });

  it("keeps register visible inside an Electron remote server iframe", async () => {
    mainAxios.isElectron.mockReturnValue(true);
    window.IS_ELECTRON_WEBVIEW = true;

    renderAuth();

    await waitFor(() => {
      expect(screen.getAllByText("common.register").length).toBeGreaterThan(0);
    });
    expect(mainAxios.requestDesktopAutoSession).not.toHaveBeenCalled();
  });
});
