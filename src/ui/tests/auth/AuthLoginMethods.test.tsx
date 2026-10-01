import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
import type {
  LoginMethodUIProps,
  SecondFactorUIProps,
} from "@termix/plugin-sdk/frontend";

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

const authMethodsApi = vi.hoisted(() => ({
  getLoginMethods: vi.fn(),
  submitLoginMethod: vi.fn(),
  startLoginRedirect: vi.fn(),
  verifySecondFactor: vi.fn(),
  challengeSecondFactor: vi.fn(),
}));

vi.mock("@/main-axios", () => mainAxios);
vi.mock("@/api/auth-methods-api", () => authMethodsApi);
vi.mock("@/plugin-host/loader", () => ({
  startPreLoginPlugins: vi.fn(async () => {}),
}));
vi.mock("@/i18n/i18n", () => ({
  changeAppLanguage: vi.fn(async (code: string) => code),
  normalizeLanguageCode: vi.fn((code: string | null) => code || "en"),
  rememberLoginLanguage: vi.fn((code: string) => code),
}));
vi.mock("../../auth/silent-signin", () => ({
  removeSilentSigninFromSearch: vi.fn(),
  shouldTriggerSilentSignin: vi.fn(() => false),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && typeof opts.name === "string" ? `${key}:${opts.name}` : key,
  }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { Auth } from "../../auth/Auth";
import {
  registerLoginMethod,
  registerSecondFactor,
} from "@/plugin-host/auth-registry";

const OriginalResizeObserver = globalThis.ResizeObserver;
const originalLocation = window.location;

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  globalThis.ResizeObserver = OriginalResizeObserver;
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  mainAxios.isElectron.mockReturnValue(false);
  mainAxios.getRegistrationAllowed.mockResolvedValue({ allowed: true });
  mainAxios.getPasswordLoginAllowed.mockResolvedValue({ allowed: true });
  mainAxios.getPasswordResetAllowed.mockResolvedValue(true);
  mainAxios.getSetupRequired.mockResolvedValue({ setup_required: false });
  mainAxios.getOidcSilentLoginDefault.mockResolvedValue({ enabled: false });
  mainAxios.requestTrustedProxyLogin.mockResolvedValue({ enabled: false });
  mainAxios.getUserInfo.mockResolvedValue({
    username: "alice",
    userId: "u1",
    is_admin: false,
  });
  authMethodsApi.getLoginMethods.mockResolvedValue([
    {
      id: "password",
      pluginId: "core",
      kind: "form",
      labelKey: "auth.password",
      instances: [{ id: "password", label: "Password" }],
    },
    {
      id: "oidc",
      pluginId: "sso",
      kind: "redirect",
      labelKey: "loginWithSso",
      instances: [{ id: "3", label: "Keycloak" }],
    },
    {
      id: "corp-sso",
      pluginId: "corp",
      kind: "redirect",
      labelKey: "corp.sso",
      instances: [{ id: "a", label: "Corp" }],
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

async function openExternalTab() {
  render(<Auth onLogin={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getAllByText("auth.external").length).toBeGreaterThan(0),
  );
  fireEvent.click(screen.getAllByText("auth.external")[0]);
}

describe("login methods on the login screen", () => {
  it("lists every enabled method", async () => {
    await openExternalTab();
    // A redirect method whose plugin UI is not loaded gets a plain button.
    expect(screen.getByText("auth.loginWithProvider:Keycloak")).toBeTruthy();
    expect(screen.getByText("auth.loginWithProvider:Corp")).toBeTruthy();
  });

  it("starts a plugin redirect login through the generic endpoint", async () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, replace, search: "" },
    });
    authMethodsApi.startLoginRedirect.mockResolvedValue("https://corp/auth");
    await openExternalTab();
    fireEvent.click(screen.getByText("auth.loginWithProvider:Corp"));
    await waitFor(() =>
      expect(authMethodsApi.startLoginRedirect).toHaveBeenCalledWith(
        "corp-sso",
        expect.objectContaining({ instanceId: "a" }),
      ),
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("https://corp/auth"),
    );
  });

  it("renders a plugin's form UI and runs its second factor", async () => {
    authMethodsApi.getLoginMethods.mockResolvedValue([
      {
        id: "corp-form",
        pluginId: "corp",
        kind: "form",
        labelKey: "corp.form",
        instances: [],
      },
    ]);
    const disposeMethod = registerLoginMethod({
      id: "corp-form",
      pluginId: "corp",
      titleKey: "corp.form",
      component: ({ submit }: LoginMethodUIProps) => (
        <button onClick={() => void submit({ token: "abc" })}>
          corp sign in
        </button>
      ),
    });
    const disposeFactor = registerSecondFactor({
      id: "pin",
      pluginId: "corp",
      titleKey: "corp.pin",
      component: ({ verify }: SecondFactorUIProps) => (
        <button onClick={() => void verify({ pin: "1234" })}>send pin</button>
      ),
    });
    authMethodsApi.submitLoginMethod.mockResolvedValue({
      success: true,
      requires_totp: true,
      temp_token: "pending-1",
      second_factors: [{ id: "pin", pluginId: "corp", labelKey: "corp.pin" }],
    });
    authMethodsApi.verifySecondFactor.mockResolvedValue({
      success: true,
      username: "alice",
    });
    const onLogin = vi.fn();
    try {
      render(<Auth onLogin={onLogin} />);
      await waitFor(() =>
        expect(screen.getAllByText("auth.external").length).toBeGreaterThan(0),
      );
      fireEvent.click(screen.getAllByText("auth.external")[0]);
      fireEvent.click(await screen.findByText("corp sign in"));
      await waitFor(() =>
        expect(authMethodsApi.submitLoginMethod).toHaveBeenCalledWith(
          "corp-form",
          expect.objectContaining({ token: "abc" }),
          undefined,
        ),
      );
      fireEvent.click(await screen.findByText("send pin"));
      await waitFor(() =>
        expect(authMethodsApi.verifySecondFactor).toHaveBeenCalledWith(
          "pin",
          expect.objectContaining({ pin: "1234", temp_token: "pending-1" }),
        ),
      );
      await waitFor(() =>
        expect(onLogin).toHaveBeenCalledWith("alice", "u1", false),
      );
    } finally {
      disposeMethod();
      disposeFactor();
    }
  });

  it("picks up the second factor step after a redirect login", async () => {
    const dispose = registerSecondFactor({
      id: "pin",
      pluginId: "corp",
      titleKey: "corp.pin",
      component: ({ verify }: SecondFactorUIProps) => (
        <button onClick={() => void verify({ pin: "1234" })}>send pin</button>
      ),
    });
    window.history.replaceState({}, "", "/?second_factor=1&second_factors=pin");
    authMethodsApi.verifySecondFactor.mockResolvedValue({ success: true });
    try {
      render(<Auth onLogin={vi.fn()} />);
      fireEvent.click(await screen.findByText("send pin"));
      await waitFor(() =>
        expect(authMethodsApi.verifySecondFactor).toHaveBeenCalledWith("pin", {
          pin: "1234",
          rememberMe: false,
        }),
      );
    } finally {
      dispose();
    }
  });

  it("offers every registered factor when the server lists none", async () => {
    const dispose = registerSecondFactor({
      id: "pin",
      pluginId: "corp",
      titleKey: "corp.pin",
      component: () => <span>pin challenge</span>,
    });
    window.history.replaceState({}, "", "/?second_factor=1");
    try {
      render(<Auth onLogin={vi.fn()} />);
      expect(await screen.findByText("pin challenge")).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it("draws an inline method under the password form, not in the external list", async () => {
    authMethodsApi.getLoginMethods.mockResolvedValue([
      {
        id: "quick-key",
        pluginId: "keys",
        kind: "form",
        labelKey: "keys.title",
        instances: [],
      },
    ]);
    const dispose = registerLoginMethod({
      id: "quick-key",
      pluginId: "keys",
      titleKey: "keys.title",
      placement: "inline",
      component: () => <button>quick key</button>,
    });
    try {
      render(<Auth onLogin={vi.fn()} />);
      expect(await screen.findByText("quick key")).toBeTruthy();
      expect(screen.queryByText("auth.external")).toBeNull();
    } finally {
      dispose();
    }
  });
});
