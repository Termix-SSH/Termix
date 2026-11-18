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
} from "@termix-ssh/plugin-sdk/frontend";

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
  getRememberDeviceAllowed: vi.fn(async () => true),
  submitLoginMethod: vi.fn(),
  startLoginRedirect: vi.fn(),
  verifySecondFactor: vi.fn(),
  challengeSecondFactor: vi.fn(),
  getPublicSecondFactors: vi.fn(async () => [] as unknown[]),
  getWebAuthnLoginOptions: vi.fn(),
}));

const browser = vi.hoisted(() => ({
  runWebAuthn: vi.fn(async () => ({ id: "cred", response: {} })),
  webAuthnSupported: vi.fn(() => true),
}));
vi.mock("../../auth/webauthn-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...browser,
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
import { startPreLoginPlugins } from "@/plugin-host/loader";
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
  it("offers remember me unless the login policy turned it off", async () => {
    await openExternalTab();
    expect(screen.getByText("auth.rememberMe")).toBeTruthy();
    cleanup();

    authMethodsApi.getRememberDeviceAllowed.mockResolvedValueOnce(false);
    await openExternalTab();
    await waitFor(() =>
      expect(screen.queryByText("auth.rememberMe")).toBeNull(),
    );
  });

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

  it("recovers an unavailable second-factor UI without restarting the login", async () => {
    window.history.replaceState({}, "", "/?second_factor=1&second_factors=pin");
    render(<Auth onLogin={vi.fn()} />);
    expect(await screen.findByText("auth.secondFactorNoUI")).toBeTruthy();
    let dispose = () => {};
    vi.mocked(startPreLoginPlugins).mockImplementationOnce(async () => {
      dispose = registerSecondFactor({
        id: "pin",
        pluginId: "corp",
        titleKey: "corp.pin",
        component: () => <span>recovered challenge</span>,
      });
    });
    try {
      fireEvent.click(screen.getByText("auth.retrySecondFactorUI"));
      expect(await screen.findByText("recovered challenge")).toBeTruthy();
      expect(startPreLoginPlugins).toHaveBeenLastCalledWith({
        retryFailed: true,
      });
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

  it("draws a plugin's form method from its fields, with no plugin code", async () => {
    authMethodsApi.getLoginMethods.mockResolvedValue([
      {
        id: "ldap",
        pluginId: "ldap",
        kind: "form",
        labelKey: "ldap.title",
        fields: [
          { name: "username", type: "text", labelKey: "username" },
          { name: "password", type: "password", labelKey: "password" },
        ],
        instances: [{ id: "7", label: "Corp" }],
      },
    ]);
    authMethodsApi.submitLoginMethod.mockResolvedValue({ success: true });
    render(<Auth onLogin={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getAllByText("auth.external").length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByText("auth.external")[0]);
    fireEvent.click(await screen.findByText("auth.loginWithProvider:Corp"));
    const inputs = document.querySelectorAll("form input");
    fireEvent.change(inputs[inputs.length - 2], { target: { value: "bob" } });
    fireEvent.change(inputs[inputs.length - 1], { target: { value: "pw" } });
    fireEvent.click(screen.getByText("auth.pluginLogin.signIn"));
    await waitFor(() =>
      expect(authMethodsApi.submitLoginMethod).toHaveBeenCalledWith(
        "ldap",
        expect.objectContaining({ username: "bob", password: "pw" }),
        "7",
      ),
    );
  });

  it("runs a passkey method through the shell's own browser prompt", async () => {
    authMethodsApi.getLoginMethods.mockResolvedValue([
      {
        id: "passkey",
        pluginId: "webauthn",
        kind: "webauthn",
        labelKey: "signIn",
        placement: "inline",
        instances: [],
      },
    ]);
    authMethodsApi.getWebAuthnLoginOptions.mockResolvedValue({
      publicKey: { challenge: "c" },
      context: { challengeId: "x1" },
    });
    authMethodsApi.submitLoginMethod.mockResolvedValue({ success: true });
    render(<Auth onLogin={vi.fn()} />);
    fireEvent.click(await screen.findByText("webauthn:signIn"));
    await waitFor(() =>
      expect(authMethodsApi.submitLoginMethod).toHaveBeenCalledWith(
        "passkey",
        expect.objectContaining({
          challengeId: "x1",
          response: { id: "cred", response: {} },
        }),
        undefined,
      ),
    );
    expect(browser.runWebAuthn).toHaveBeenCalledWith("get", { challenge: "c" });
  });

  it("draws a code second factor from its prompt after a redirect login", async () => {
    authMethodsApi.getPublicSecondFactors.mockResolvedValue([
      {
        id: "totp",
        pluginId: "totp",
        labelKey: "title",
        prompt: { kind: "code", field: "totp_code", length: 6 },
      },
    ]);
    authMethodsApi.verifySecondFactor.mockResolvedValue({ success: true });
    window.history.replaceState(
      {},
      "",
      "/?second_factor=1&second_factors=totp",
    );
    render(<Auth onLogin={vi.fn()} />);
    const input = await waitFor(() => {
      const found = document.querySelector("form input");
      if (!found) throw new Error("no field yet");
      return found;
    });
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByText("auth.pluginLogin.verify"));
    await waitFor(() =>
      expect(authMethodsApi.verifySecondFactor).toHaveBeenCalledWith("totp", {
        totp_code: "123456",
        rememberMe: false,
      }),
    );
  });

  it("runs a security key second factor through the shell", async () => {
    authMethodsApi.challengeSecondFactor.mockResolvedValue({
      challenge: "k",
      allowCredentials: [],
    });
    authMethodsApi.verifySecondFactor.mockResolvedValue({ success: true });
    authMethodsApi.submitLoginMethod.mockResolvedValue({
      success: true,
      requires_totp: true,
      temp_token: "pending-2",
      second_factors: [
        {
          id: "security-key",
          pluginId: "webauthn",
          labelKey: "securityKey.title",
          prompt: { kind: "webauthn" },
        },
      ],
    });
    window.history.replaceState(
      {},
      "",
      "/?second_factor=1&second_factors=security-key",
    );
    authMethodsApi.getPublicSecondFactors.mockResolvedValue([
      {
        id: "security-key",
        pluginId: "webauthn",
        labelKey: "securityKey.title",
        prompt: { kind: "webauthn" },
      },
    ]);
    render(<Auth onLogin={vi.fn()} />);
    fireEvent.click(await screen.findByText("auth.pluginLogin.useKey"));
    await waitFor(() =>
      expect(authMethodsApi.verifySecondFactor).toHaveBeenCalledWith(
        "security-key",
        { response: { id: "cred", response: {} }, rememberMe: false },
      ),
    );
    expect(browser.runWebAuthn).toHaveBeenCalledWith("get", {
      challenge: "k",
      allowCredentials: [],
    });
  });
});
