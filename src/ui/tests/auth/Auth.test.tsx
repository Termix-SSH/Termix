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
  isElectron: vi.fn(),
  getCurrentToken: vi.fn(),
  getOidcSilentLoginDefault: vi.fn(),
  requestDesktopAutoSession: vi.fn(),
  requestTrustedProxyLogin: vi.fn(),
}));

vi.mock("@/main-axios", () => mainAxios);

const appReturn = vi.hoisted(() => ({
  pendingAppReturn: vi.fn((): string | null => null),
  handOffToApp: vi.fn(() => true),
}));
vi.mock("@/lib/app-return", () => appReturn);
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
  mainAxios.requestTrustedProxyLogin.mockResolvedValue({
    enabled: false,
    success: false,
  });
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
      expect(screen.getByText("auth.localDesktopSignedOut")).toBeTruthy();
    });
    expect(screen.getByText("auth.continueLocalDesktop")).toBeTruthy();
    expect(screen.queryByText("common.register")).toBeNull();
    expect(screen.queryByLabelText("common.username")).toBeNull();
    expect(screen.queryByText("auth.forgotPassword")).toBeNull();
    expect(mainAxios.getSetupRequired).not.toHaveBeenCalled();
  });

  it("shows local recovery instead of register when auto-session is declined", async () => {
    mainAxios.isElectron.mockReturnValue(true);
    mainAxios.requestDesktopAutoSession.mockResolvedValue({ kind: "declined" });
    mainAxios.requestTrustedProxyLogin.mockResolvedValue({
      enabled: false,
      success: false,
    });

    renderAuth();

    await waitFor(() => {
      expect(screen.getByText("auth.localDesktopUnavailable")).toBeTruthy();
    });
    expect(screen.getByText("auth.retryLocalDesktop")).toBeTruthy();
    expect(screen.queryByText("common.register")).toBeNull();
    expect(screen.queryByLabelText("common.username")).toBeNull();
    expect(mainAxios.requestDesktopAutoSession).toHaveBeenCalled();
    expect(mainAxios.getSetupRequired).not.toHaveBeenCalled();
  });

  it("keeps checking after the server is unreachable and recovers on its own", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mainAxios.getSetupRequired.mockRejectedValue(new Error("502"));
      renderAuth();
      await vi.advanceTimersByTimeAsync(20000);
      expect(screen.getByText("errors.databaseConnection")).toBeTruthy();

      mainAxios.getSetupRequired.mockResolvedValue({ setup_required: false });
      await vi.advanceTimersByTimeAsync(6000);
      await waitFor(() =>
        expect(screen.queryByText("errors.databaseConnection")).toBeNull(),
      );
    } finally {
      vi.useRealTimers();
    }
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

describe("Auth sign in for the mobile app", () => {
  it("sends a trusted proxy login back to the app instead of opening Termix", async () => {
    appReturn.pendingAppReturn.mockReturnValue("termix-mobile://oidc-callback");
    mainAxios.requestTrustedProxyLogin.mockResolvedValue({
      enabled: true,
      success: true,
      username: "alice",
    });
    mainAxios.getCurrentToken.mockResolvedValue("tok-1");
    const onLogin = vi.fn();

    render(<Auth onLogin={onLogin} />);

    await waitFor(() =>
      expect(appReturn.handOffToApp).toHaveBeenCalledWith({ token: "tok-1" }),
    );
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("signs in normally when no app asked", async () => {
    appReturn.pendingAppReturn.mockReturnValue(null);
    mainAxios.requestTrustedProxyLogin.mockResolvedValue({
      enabled: true,
      success: true,
      username: "alice",
    });
    const onLogin = vi.fn();

    render(<Auth onLogin={onLogin} />);

    await waitFor(() => expect(onLogin).toHaveBeenCalled());
    expect(appReturn.handOffToApp).not.toHaveBeenCalled();
  });
});
