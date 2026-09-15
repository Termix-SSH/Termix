import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/i18n/i18n", () => ({
  default: { changeLanguage: vi.fn() },
  changeAppLanguage: vi.fn().mockResolvedValue("en"),
  normalizeLanguageCode: () => "en",
  rememberLoginLanguage: (code: string) => code,
}));

const requestDesktopAutoSession = vi.fn();

vi.mock("@/main-axios", () => ({
  requestDesktopAutoSession: () => requestDesktopAutoSession(),
  isElectron: () => true,
  login: vi.fn(),
  registerUser: vi.fn(),
  getRegistrationAllowed: vi.fn().mockResolvedValue({ allowed: false }),
  getPasswordLoginAllowed: vi.fn().mockResolvedValue({ allowed: true }),
  getPasswordResetAllowed: vi.fn().mockResolvedValue(false),
  getSetupRequired: vi.fn().mockRejectedValue(new Error("backend down")),
  getOidcSilentLoginDefault: vi.fn().mockResolvedValue({ enabled: false }),
  initiatePasswordReset: vi.fn(),
  verifyPasswordResetCode: vi.fn(),
  completePasswordReset: vi.fn(),
  getOIDCAuthorizeUrl: vi.fn(),
  verifyTOTPLogin: vi.fn(),
  getCurrentToken: vi.fn().mockReturnValue(null),
  requestTrustedProxyLogin: vi.fn(),
}));

vi.mock("@/api/sso-provider-api", () => ({
  getSSOProviders: vi.fn().mockResolvedValue([]),
  ldapLogin: vi.fn(),
}));

vi.mock("@/api/webauthn-api", () => ({
  isPasskeySupported: () => false,
  loginWithPasskey: vi.fn(),
}));

import { Auth } from "@/auth/Auth";

function setEmbeddedServerStatus(failure: unknown) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    isElectron: true,
    getEmbeddedServerStatus: vi.fn().mockResolvedValue({
      running: false,
      failure,
    }),
  };
}

beforeEach(() => {
  // jsdom in this project ships without a localStorage global, and Auth
  // reads the remembered language from it on mount.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  });
  requestDesktopAutoSession.mockResolvedValue({ kind: "retry" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.clearAllMocks();
});

describe("Auth on a desktop launch where the embedded backend never came up", () => {
  it("names the port instead of spinning forever when the port is taken", async () => {
    setEmbeddedServerStatus({ reason: "port-in-use", port: 30001 });

    render(<Auth onLogin={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("errors.embeddedServerFailed")).toBeTruthy(),
    );
    expect(
      screen.getByText('messages.embeddedServerPortInUse:{"port":30001}'),
    ).toBeTruthy();
  });

  it("falls back to a portless message when the port could not be parsed", async () => {
    setEmbeddedServerStatus({ reason: "port-in-use", port: null });

    render(<Auth onLogin={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByText("messages.embeddedServerPortInUseUnknownPort"),
      ).toBeTruthy(),
    );
  });

  it("reports a crash for any other hard backend failure", async () => {
    setEmbeddedServerStatus({ reason: "crashed", port: null });

    render(<Auth onLogin={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("messages.embeddedServerCrashed")).toBeTruthy(),
    );
  });

  it("keeps waiting, showing no error, while the backend is only slow to boot", async () => {
    setEmbeddedServerStatus(null);

    render(<Auth onLogin={vi.fn()} />);

    await waitFor(() => expect(requestDesktopAutoSession).toHaveBeenCalled());
    expect(screen.queryByText("errors.embeddedServerFailed")).toBeNull();
  });
});
