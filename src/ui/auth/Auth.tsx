/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Separator } from "@/components/separator";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  User,
  KeyRound,
  ArrowLeft,
  Shield,
  CheckCircle2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  loginUser,
  registerUser,
  getUserInfo,
  getRegistrationAllowed,
  getPasswordLoginAllowed,
  getPasswordResetAllowed,
  getSetupRequired,
  initiatePasswordReset,
  verifyPasswordResetCode,
  completePasswordReset,
  isElectron,
  getCurrentToken,
  getOidcSilentLoginDefault,
  requestDesktopAutoSession,
  requestTrustedProxyLogin,
} from "@/main-axios";
import {
  getEmbeddedServerFailure,
  type EmbeddedServerFailure,
} from "@/lib/embedded-server-status";
import {
  challengeSecondFactor,
  getLoginMethods,
  startLoginRedirect,
  submitLoginMethod,
  verifySecondFactor,
  type LoginResponse,
  type PublicLoginMethod,
  type SecondFactorRef,
} from "@/api/auth-methods-api";
import { useLoginMethods, useSecondFactors } from "@/plugin-host/auth-registry";
import { startPreLoginPlugins } from "@/plugin-host/loader";
import { Checkbox } from "@/components/checkbox";
import { useBranding } from "@/contexts/BrandingContext";
import {
  changeAppLanguage,
  normalizeLanguageCode,
  rememberLoginLanguage,
} from "@/i18n/i18n";
import {
  removeSilentSigninFromSearch,
  shouldTriggerSilentSignin,
} from "./silent-signin";
import { Select2 } from "@/components/select2";
import { cn } from "@/lib/utils";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "ar", label: "العربية" },
  { code: "bn", label: "বাংলা" },
  { code: "bg", label: "Български" },
  { code: "ca", label: "Català" },
  { code: "zh-CN", label: "中文 (简体)" },
  { code: "zh-TW", label: "中文 (繁體)" },
  { code: "cs", label: "Čeština" },
  { code: "da", label: "Dansk" },
  { code: "nl", label: "Nederlands" },
  { code: "fi", label: "Suomi" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "el", label: "Ελληνικά" },
  { code: "he", label: "עברית" },
  { code: "hi", label: "हिन्दी" },
  { code: "hu", label: "Magyar" },
  { code: "id", label: "Indonesia" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "no", label: "Norsk" },
  { code: "pl", label: "Polski" },
  { code: "pt-PT", label: "Português (PT)" },
  { code: "pt-BR", label: "Português (BR)" },
  { code: "ro", label: "Română" },
  { code: "ru", label: "Русский" },
  { code: "sr", label: "Српски" },
  { code: "es-ES", label: "Español" },
  { code: "sv-SE", label: "Svenska" },
  { code: "th", label: "ไทย" },
  { code: "tr", label: "Türkçe" },
  { code: "uk", label: "Українська" },
  { code: "vi", label: "Tiếng Việt" },
];

function LanguageRow({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <Select2
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        align="end"
        contentClassName="w-56"
        className="h-8 w-40 shrink-0 px-2.5 text-xs"
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}
          </option>
        ))}
      </Select2>
    </div>
  );
}

const STORAGE_KEY = "termix_auth";

/** An empty list means "whichever factors this screen has UI for". */
function parseSecondFactorIds(value: string | null): SecondFactorRef[] {
  const ids = (value ?? "").split(",").filter(Boolean);
  return ids.map((id) => ({ id, pluginId: "", labelKey: "" }));
}
const DESKTOP_MANUAL_LOGOUT_KEY = "termix_desktop_manual_logout";

export function getStoredAuth(): {
  loggedIn: boolean;
  username: string;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearStoredAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export function markDesktopManualLogout() {
  localStorage.setItem(DESKTOP_MANUAL_LOGOUT_KEY, "true");
}

export function clearDesktopManualLogout() {
  localStorage.removeItem(DESKTOP_MANUAL_LOGOUT_KEY);
}

function hasDesktopManualLogout() {
  return localStorage.getItem(DESKTOP_MANUAL_LOGOUT_KEY) === "true";
}

function storeAuth(username: string) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ loggedIn: true, username }),
  );
}

type AuthView = "login" | "register" | "reset" | "second-factor" | "external";
type ResetStep = "email" | "code" | "newpass";

interface AuthProps {
  onLogin: (username: string, userId?: string, isAdmin?: boolean) => void;
}

interface ExtendedWindow extends Window {
  IS_ELECTRON_WEBVIEW?: boolean;
  ReactNativeWebView?: { postMessage: (msg: string) => void };
}

const isInMobileWebView = () =>
  /Termix-Mobile\/(Android|iOS)/.test(navigator.userAgent) ||
  !!(window as ExtendedWindow).ReactNativeWebView;

const isInElectronWebView = () => {
  if (isInMobileWebView()) return false;
  if ((window as ExtendedWindow).IS_ELECTRON_WEBVIEW) return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  return false;
};

function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "••••••••"}
        disabled={disabled}
        className="pr-9 font-mono"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((o) => !o)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
    >
      {children}
    </label>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
    </div>
  );
}

export function Auth({ onLogin }: AuthProps) {
  const { t } = useTranslation();
  const branding = useBranding();
  const localDesktopAuth = isElectron() && !isInElectronWebView();
  const [view, setView] = useState<AuthView>("login");
  const [loading, setLoading] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(() => {
    try {
      return localStorage.getItem("rememberMe") === "true";
    } catch {
      return false;
    }
  });

  // An empty token means the server holds the pending login in a cookie,
  // which is how a redirect login hands over to the second factor step.
  const [pendingToken, setPendingToken] = useState("");
  const [secondFactors, setSecondFactors] = useState<SecondFactorRef[]>([]);
  const [activeFactorId, setActiveFactorId] = useState("");
  const loginMethodUIs = useLoginMethods();
  const secondFactorUIs = useSecondFactors();
  // A server that did not list its factors gets every factor with a UI here.
  const shownFactors: SecondFactorRef[] =
    secondFactors.length > 0
      ? secondFactors
      : secondFactorUIs.map((ui) => ({
          id: ui.id,
          pluginId: ui.pluginId ?? "",
          labelKey: ui.titleKey,
        }));
  const currentFactorId = activeFactorId || shownFactors[0]?.id || "";

  const [resetStep, setResetStep] = useState<ResetStep>("email");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resetTempToken, setResetTempToken] = useState("");

  const [language, setLanguage] = useState(() =>
    normalizeLanguageCode(localStorage.getItem("i18nextLng")),
  );

  function handleLanguageChange(code: string) {
    const language = rememberLoginLanguage(code);
    void changeAppLanguage(language)
      .then((language) => setLanguage(language))
      .catch(() => {});
  }

  const [registrationAllowed, setRegistrationAllowed] = useState(true);
  const [passwordLoginAllowed, setPasswordLoginAllowed] = useState(true);
  const [passwordResetAllowed, setPasswordResetAllowed] = useState(true);
  const [authMethods, setAuthMethods] = useState<PublicLoginMethod[]>([]);
  const [authMethodsLoaded, setAuthMethodsLoaded] = useState(false);
  const inlineMethodIds = new Set(
    loginMethodUIs.filter((ui) => ui.placement === "inline").map((ui) => ui.id),
  );
  const inlineMethods = authMethods.filter((method) =>
    inlineMethodIds.has(method.id),
  );
  const externalMethods = authMethods.filter(
    (method) => method.id !== "password" && !inlineMethodIds.has(method.id),
  );
  const silentSigninHandledRef = useRef(false);
  const proxySigninHandledRef = useRef(false);
  const [oidcSilentLoginDefault, setOidcSilentLoginDefault] = useState(false);
  const [oidcSilentLoginDefaultLoaded, setOidcSilentLoginDefaultLoaded] =
    useState(false);
  const [firstUser, setFirstUser] = useState(false);
  const [dbConnectionFailed, setDbConnectionFailed] = useState(false);
  const [dbHealthChecking, setDbHealthChecking] = useState(
    () => !localDesktopAuth || !hasDesktopManualLogout(),
  );
  const [webviewAuthSuccess, setWebviewAuthSuccess] = useState(false);
  const [desktopManualLogoutActive, setDesktopManualLogoutActive] = useState(
    () => localDesktopAuth && hasDesktopManualLogout(),
  );

  // Electron, non-iframed only: the desktop app owns an embedded local
  // backend with an auto-provisioned local user, so it should never show
  // username/password registration for that local surface. null means the
  // auto-session probe is still in flight; true means the probe settled
  // without a session and the local recovery panel can render.
  const [desktopAutoSessionDone, setDesktopAutoSessionDone] = useState<
    boolean | null
  >(!localDesktopAuth || hasDesktopManualLogout() ? true : null);
  const [desktopAutoSessionRetries, setDesktopAutoSessionRetries] = useState(0);
  // Set only when the Electron main process reports that the embedded
  // backend died for good, which is the one case where retrying the
  // auto-session forever is wrong.
  const [embeddedServerFailure, setEmbeddedServerFailure] =
    useState<EmbeddedServerFailure | null>(null);

  useEffect(() => {
    if (proxySigninHandledRef.current || isElectron()) return;
    proxySigninHandledRef.current = true;
    requestTrustedProxyLogin()
      .then((result) => {
        if (!result.enabled || !result.success) return;
        storeAuth(result.username || "");
        onLogin(
          result.username || "",
          result.userId || undefined,
          !!result.is_admin,
        );
      })
      .catch(() => {
        // Leave the login screen visible. The backend logs the reason without
        // exposing trusted proxy configuration to an untrusted client.
      });
  }, [onLogin]);

  useEffect(() => {
    try {
      localStorage.setItem("rememberMe", rememberMe.toString());
    } catch {
      // Ignore storage failures; auth state still works for the current session.
    }
  }, [rememberMe]);

  useEffect(() => {
    if (!isInElectronWebView()) return;

    const handleOIDCSystemBrowserResult = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type !== "OIDC_SYSTEM_BROWSER_AUTH_RESULT") return;

      if (event.data.success) return;
      setLoading(false);
      if (event.data.secondFactor) {
        enterSecondFactorStep(
          event.data.tempToken ?? "",
          parseSecondFactorIds(event.data.factors ?? null),
        );
        return;
      }
      toast.error(event.data.error || t("errors.failedOidcLogin"));
    };

    window.addEventListener("message", handleOIDCSystemBrowserResult);
    return () =>
      window.removeEventListener("message", handleOIDCSystemBrowserResult);
  }, [t]);

  useEffect(() => {
    if (localDesktopAuth) {
      setAuthMethodsLoaded(true);
      setOidcSilentLoginDefaultLoaded(true);
      return;
    }
    getRegistrationAllowed()
      .then((res) => setRegistrationAllowed(res.allowed))
      .catch(() => {});
    getPasswordLoginAllowed()
      .then((res) => setPasswordLoginAllowed(res.allowed))
      .catch(() => {});
    getPasswordResetAllowed()
      .then((allowed) => setPasswordResetAllowed(allowed))
      .catch(() => setPasswordResetAllowed(false));
    // Plugins that draw login or second-factor UI load before sign-in.
    void startPreLoginPlugins().catch(() => {});
    getLoginMethods()
      .then((methods) => setAuthMethods(methods))
      .catch(() => setAuthMethods([]))
      .finally(() => setAuthMethodsLoaded(true));
    getOidcSilentLoginDefault()
      .then((res) => setOidcSilentLoginDefault(res.enabled))
      .catch(() => {})
      .finally(() => setOidcSilentLoginDefaultLoaded(true));
  }, [localDesktopAuth]);

  useEffect(() => {
    // Runs once the auto-session probe has settled (immediately outside
    // Electron, since it starts at true there; after the probe resolves in
    // Electron). Waiting avoids flashing a login screen the user is about
    // to skip past via auto-login.
    if (desktopAutoSessionDone !== true) return;
    if (localDesktopAuth) {
      setDbHealthChecking(false);
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Right after a server update/restart (or behind a reverse proxy that's
    // still warming up), the very first request can transiently fail even
    // though the backend/database is fine seconds later. A single failure
    // here used to permanently show the "could not connect to the database"
    // screen, forcing users to manually reload -- sometimes repeatedly.
    // Retry a few times with backoff before treating it as a real failure.
    const maxAttempts = 5;
    const attempt = (attemptNumber: number) => {
      getSetupRequired()
        .then((res) => {
          if (cancelled) return;
          if (res.setup_required) {
            setFirstUser(true);
            setView("register");
          }
          setDbConnectionFailed(false);
          setDbHealthChecking(false);
        })
        .catch(() => {
          if (cancelled) return;
          if (attemptNumber >= maxAttempts) {
            setDbConnectionFailed(true);
            setDbHealthChecking(false);
            return;
          }
          const delay = Math.min(500 * 2 ** attemptNumber, 5000);
          retryTimer = setTimeout(() => {
            if (!cancelled) attempt(attemptNumber + 1);
          }, delay);
        });
    };

    setDbHealthChecking(true);
    attempt(0);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [desktopAutoSessionDone, localDesktopAuth]);

  // A cold first launch spawns the embedded backend as a separate process
  // that can take anywhere from a couple seconds to much longer to finish
  // booting (DB init, SSL, antivirus scanning a freshly-unpacked binary,
  // slow disks, etc.) -- well after the renderer has already mounted. The
  // embedded backend is bundled, always-on infrastructure, not something
  // that can be "not there" -- it always eventually comes up. So a
  // "retry" outcome (connection error, not a real verdict) is retried
  // forever with capped backoff rather than ever giving up and falling
  // through to the login form: that form is not a valid destination for a
  // standalone install with no remote sync configured. Only a definitive
  // "declined" stops retrying and shows a local recovery panel.
  useEffect(() => {
    if (desktopAutoSessionDone !== null) return;
    if (embeddedServerFailure) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // "Retry forever" holds only while the backend could still be booting.
    // If the main process reports that it exited -- a port conflict being
    // by far the most common cause -- there is nothing left to wait for, so
    // the reason is shown instead of an unending spinner.
    const retryUnlessBackendIsGone = async () => {
      const failure = await getEmbeddedServerFailure();
      if (cancelled) return;
      if (failure) {
        setEmbeddedServerFailure(failure);
        return;
      }
      const delay = Math.min(1000 * 2 ** desktopAutoSessionRetries, 10000);
      retryTimer = setTimeout(() => {
        if (!cancelled) setDesktopAutoSessionRetries((c) => c + 1);
      }, delay);
    };

    requestDesktopAutoSession()
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.kind === "success") {
          storeAuth(outcome.data.username || "");
          clearDesktopManualLogout();
          onLogin(
            outcome.data.username || "",
            outcome.data.userId || undefined,
            !!outcome.data.is_admin,
          );
          return;
        }
        if (outcome.kind === "retry") {
          void retryUnlessBackendIsGone();
          return;
        }
        setDesktopAutoSessionDone(true);
      })
      .catch(() => {
        if (cancelled) return;
        void retryUnlessBackendIsGone();
      });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    desktopAutoSessionDone,
    desktopAutoSessionRetries,
    embeddedServerFailure,
    onLogin,
  ]);

  useEffect(() => {
    if (!authMethodsLoaded) return;
    if (
      !passwordLoginAllowed &&
      externalMethods.length > 0 &&
      view === "login"
    ) {
      setView("external");
    }
  }, [authMethodsLoaded, passwordLoginAllowed, externalMethods.length, view]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get("success");
    const error = urlParams.get("error");
    if (urlParams.get("second_factor") === "1") {
      enterSecondFactorStep(
        urlParams.get("temp_token") ?? "",
        parseSecondFactorIds(urlParams.get("second_factors")),
      );
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }
    if (error) {
      if (error === "registration_disabled")
        toast.error(t("messages.registrationDisabled"));
      else if (error === "user_not_allowed")
        toast.error(t("messages.userNotAllowed"));
      else if (error === "second_factor_unavailable")
        toast.error(t("auth.secondFactorUnavailable"));
      else toast.error(`${t("errors.oidcAuthFailed")}: ${error}`);
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }
    if (success) {
      if (isInMobileWebView()) {
        // The OIDC callback authenticated via an HttpOnly cookie on this origin,
        // so the token isn't in localStorage. Prefer a token passed in the URL
        // (termix-mobile:-origin callbacks include one), otherwise read it back
        // from the cookie via /users/me/token before handing it to the app.
        const postToken = (token: string) => {
          (window as ExtendedWindow).ReactNativeWebView?.postMessage(
            JSON.stringify({ type: "AUTH_SUCCESS", token }),
          );
          setWebviewAuthSuccess(true);
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        };
        const urlToken = urlParams.get("token");
        if (urlToken) {
          postToken(urlToken);
        } else {
          getCurrentToken()
            .then((token) => postToken(token ?? ""))
            .catch(() => postToken(""));
        }
        return;
      }
      if (isInElectronWebView()) {
        // Electron Remote Sync embeds the remote server in an iframe. The
        // OIDC callback authenticates by setting the remote origin's
        // HttpOnly cookie, so read the JWT back before notifying the parent.
        const postToken = (token: string | null) => {
          window.parent.postMessage(
            {
              type: "AUTH_SUCCESS",
              source: "oidc_callback",
              platform: "desktop",
              token,
              timestamp: Date.now(),
            },
            "*",
          );
          setWebviewAuthSuccess(true);
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        };
        const urlToken = urlParams.get("token");
        if (urlToken) {
          postToken(urlToken);
        } else {
          getCurrentToken()
            .then((token) => postToken(token ?? null))
            .catch(() => postToken(null));
        }
        return;
      }
      getUserInfo()
        .then((meRes) => {
          storeAuth(meRes.username || "");
          clearDesktopManualLogout();
          onLogin(
            meRes.username || "",
            meRes.userId || undefined,
            !!meRes.is_admin,
          );
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        })
        .catch(() => {
          toast.error(t("errors.failedUserInfo"));
        });
    }
  }, [onLogin, t]);

  function resetAll() {
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setResetStep("email");
    setResetCode("");
    setNewPassword("");
    setConfirmNewPassword("");
    setResetTempToken("");
    setPendingToken("");
  }

  function switchView(v: AuthView) {
    const currentUsername = username;
    resetAll();
    if (v === "reset") setUsername(currentUsername);
    setView(v);
  }

  function continueLocalDesktopSession() {
    clearDesktopManualLogout();
    setDesktopManualLogoutActive(false);
    setDesktopAutoSessionRetries(0);
    setDesktopAutoSessionDone(null);
  }

  function enterSecondFactorStep(
    tempToken: string,
    factors: SecondFactorRef[] = [],
  ) {
    setPendingToken(tempToken);
    setSecondFactors(factors);
    setActiveFactorId(factors[0]?.id ?? "");
    setLoading(false);
    setView("second-factor");
  }

  function showLoginError(err: unknown, fallbackKey: string) {
    const error = err as {
      message?: string;
      response?: { data?: { error?: string; code?: string } };
    };
    if (error?.response?.data?.code === "SESSION_EXPIRED") {
      setView("login");
      toast.error(t("errors.sessionExpired"));
      return;
    }
    if (error?.response?.data?.code === "second_factor_unavailable") {
      toast.error(t("auth.secondFactorUnavailable"));
      return;
    }
    toast.error(
      error?.response?.data?.error || error?.message || t(fallbackKey),
    );
  }

  /**
   * Every login ends here: the second-factor step, a hand-off to the mobile
   * or desktop shell, or signing in this window.
   */
  async function finishLogin(
    res: LoginResponse,
    source: string,
    options: { fallbackUsername?: string; successKey?: string } = {},
  ) {
    if (res?.requires_totp || res?.requires_second_factor) {
      enterSecondFactorStep(res.temp_token ?? "", res.second_factors);
      return;
    }
    if (!res?.success) throw new Error(t("errors.loginFailed"));
    if (isInMobileWebView()) {
      // Native-app requests get the JWT in the login response body.
      const token = res?.token ?? "";
      (window as ExtendedWindow).ReactNativeWebView?.postMessage(
        JSON.stringify({ type: "AUTH_SUCCESS", token }),
      );
      setWebviewAuthSuccess(true);
      return;
    }
    if (isInElectronWebView()) {
      // The iframe never sends X-Electron-App, so the JWT only lands in an
      // HttpOnly cookie on this origin. Read it back for the parent window.
      const token = res?.token ?? (await getCurrentToken());
      window.parent.postMessage(
        {
          type: "AUTH_SUCCESS",
          source,
          platform: "desktop",
          token: token ?? null,
          timestamp: Date.now(),
        },
        "*",
      );
      setWebviewAuthSuccess(true);
      return;
    }
    const meRes = await getUserInfo();
    const name =
      meRes.username || res.username || options.fallbackUsername || "";
    storeAuth(name);
    clearDesktopManualLogout();
    toast.success(t(options.successKey ?? "messages.loginSuccess"));
    onLogin(name, meRes.userId || undefined, !!meRes.is_admin);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      toast.error(t("errors.requiredField"));
      return;
    }
    setLoading(true);
    try {
      const res = await loginUser(username.trim(), password, rememberMe);
      await finishLogin(res, "auth_component", {
        fallbackUsername: username.trim(),
      });
    } catch (err: unknown) {
      showLoginError(err, "errors.unknownError");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      toast.error(t("errors.requiredField"));
      return;
    }
    if (password.length < 6) {
      toast.error(t("errors.minLength", { min: 6 }));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t("errors.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await registerUser(username.trim(), password);
      const res = await loginUser(username.trim(), password, rememberMe);
      await finishLogin(res, "auth_component", {
        fallbackUsername: username.trim(),
        successKey: "messages.registrationSuccess",
      });
    } catch (err: unknown) {
      showLoginError(err, "errors.unknownError");
    } finally {
      setLoading(false);
    }
  }

  /** Form login for any method: LDAP, a plugin's form, ... */
  async function submitMethod(
    methodId: string,
    body: Record<string, unknown>,
    instanceId?: string,
  ) {
    setLoading(true);
    try {
      const res = await submitLoginMethod(
        methodId,
        { ...body, rememberMe },
        instanceId,
      );
      await finishLogin(res, "method_auth_component");
    } catch (err: unknown) {
      showLoginError(err, "errors.loginFailed");
    } finally {
      setLoading(false);
    }
  }

  async function completeMethodResponse(
    response: Record<string, unknown>,
    source = "method_auth_component",
  ) {
    await finishLogin(response as LoginResponse, source);
  }

  async function verifyActiveFactor(body: Record<string, unknown>) {
    setLoading(true);
    try {
      const res = await verifySecondFactor(currentFactorId, {
        ...body,
        rememberMe,
        ...(pendingToken ? { temp_token: pendingToken } : {}),
      });
      await finishLogin(res, "second_factor_auth_component", {
        fallbackUsername: username,
      });
    } catch (err: unknown) {
      showLoginError(err, "errors.invalidTotpCode");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetInitiate(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      toast.error(t("errors.requiredField"));
      return;
    }
    setLoading(true);
    try {
      await initiatePasswordReset(username.trim());
      setResetStep("code");
      toast.success(t("messages.resetCodeSent"));
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.failedPasswordReset"),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResetVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await verifyPasswordResetCode(username.trim(), resetCode);
      setResetTempToken(res.tempToken as string);
      setResetStep("newpass");
      toast.success(t("messages.codeVerified"));
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.failedVerifyCode"),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResetComplete(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error(t("errors.minLength", { min: 6 }));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error(t("errors.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await completePasswordReset(username.trim(), resetTempToken, newPassword);
      toast.success(t("messages.passwordResetSuccess"));
      switchView("login");
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.failedCompleteReset"),
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * Sends the browser to a redirect login method. Inside the desktop app
   * the system browser does it instead, so captcha stages render and the
   * callback comes back to a local port.
   */
  const startRedirect = useCallback(
    async (methodId: string, instanceId?: string) => {
      setLoading(true);
      try {
        const callbackPort = 17832 + Math.floor(Math.random() * 100);
        if (isInElectronWebView()) {
          const authUrl = await startLoginRedirect(methodId, {
            instanceId,
            rememberMe,
            desktopCallbackPort: callbackPort,
          });
          if (!authUrl) throw new Error(t("errors.invalidAuthUrl"));
          window.parent.postMessage(
            {
              type: "OIDC_SYSTEM_BROWSER_AUTH",
              source: "oidc_request",
              authUrl,
              callbackPort,
              providerId: -1,
            },
            "*",
          );
          return;
        }
        if (isElectron()) {
          const electronAPI = (
            window as unknown as {
              electronAPI?: {
                oidcSystemBrowserAuth?: (
                  authUrl: string,
                  port: number,
                ) => Promise<{
                  success: boolean;
                  token?: string;
                  error?: string;
                  secondFactor?: boolean;
                  tempToken?: string;
                  factors?: string;
                }>;
              };
            }
          ).electronAPI;
          if (electronAPI?.oidcSystemBrowserAuth) {
            const authUrl = await startLoginRedirect(methodId, {
              instanceId,
              rememberMe,
              desktopCallbackPort: callbackPort,
            });
            if (!authUrl) throw new Error(t("errors.invalidAuthUrl"));
            const result = await electronAPI.oidcSystemBrowserAuth(
              authUrl,
              callbackPort,
            );
            if (result.success && result.token) {
              localStorage.setItem("jwt", result.token);
              window.location.reload();
              return;
            }
            if (result.secondFactor) {
              enterSecondFactorStep(
                result.tempToken ?? "",
                parseSecondFactorIds(result.factors ?? null),
              );
              return;
            }
            throw new Error(result.error || "Authentication failed");
          }
        }
        const authUrl = await startLoginRedirect(methodId, {
          instanceId,
          rememberMe,
        });
        if (!authUrl || authUrl === "undefined")
          throw new Error(t("errors.invalidAuthUrl"));
        window.location.replace(authUrl);
      } catch (err: unknown) {
        showLoginError(err, "errors.failedOidcLogin");
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rememberMe, t],
  );

  /** Draws a login method with the UI its plugin (or core) registered. */
  function renderLoginMethod(method: PublicLoginMethod) {
    const ui = loginMethodUIs.find((candidate) => candidate.id === method.id);
    const props = {
      methodId: method.id,
      instances: method.instances,
      rememberMe,
      disabled: loading,
      username,
      submit: (body: Record<string, unknown>, instanceId?: string) =>
        submitMethod(method.id, body, instanceId),
      startRedirect: (instanceId?: string) =>
        startRedirect(method.id, instanceId),
      complete: (response: Record<string, unknown>) =>
        completeMethodResponse(response).catch((err) =>
          showLoginError(err, "errors.loginFailed"),
        ),
    };
    if (ui) {
      const Component = ui.component;
      return <Component key={method.id} {...props} />;
    }
    // A redirect method needs no UI of its own: one button per instance.
    if (method.kind === "redirect") {
      return method.instances.map((instance) => (
        <Button
          key={`${method.id}:${instance.id}`}
          onClick={() => void startRedirect(method.id, instance.id)}
          disabled={loading}
          className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold"
        >
          {t("auth.loginWithProvider", { name: instance.label })}
        </Button>
      ));
    }
    return null;
  }

  useEffect(() => {
    if (!authMethodsLoaded || silentSigninHandledRef.current) return;
    if (!oidcSilentLoginDefaultLoaded) return;

    const urlTriggered = shouldTriggerSilentSignin(window.location.search);
    if (!urlTriggered && !oidcSilentLoginDefault) return;

    if (urlTriggered) {
      const nextSearch = removeSilentSigninFromSearch(window.location.search);
      window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}${nextSearch}${window.location.hash}`,
      );
    }

    silentSigninHandledRef.current = true;

    const redirectMethod = externalMethods.find(
      (method) => method.kind === "redirect" && method.instances.length > 0,
    );
    if (redirectMethod && !isElectron()) {
      void startRedirect(redirectMethod.id, redirectMethod.instances[0].id);
      return;
    }

    if (urlTriggered) {
      toast.info(t("errors.silentSigninOidcUnavailable"));
    }
  }, [
    startRedirect,
    authMethodsLoaded,
    externalMethods,
    t,
    oidcSilentLoginDefault,
    oidcSilentLoginDefaultLoaded,
  ]);

  // Electron, non-iframed: wait for the auto-session probe before rendering
  // anything, so a standalone desktop install never flashes a login form
  // it's about to skip past.
  if (embeddedServerFailure) {
    const detail =
      embeddedServerFailure.reason === "port-in-use"
        ? embeddedServerFailure.port !== null
          ? t("messages.embeddedServerPortInUse", {
              port: embeddedServerFailure.port,
            })
          : t("messages.embeddedServerPortInUseUnknownPort")
        : t("messages.embeddedServerCrashed");

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background p-6">
        <div className="flex flex-col gap-5 p-6 border border-border bg-card max-w-sm w-full">
          <div className="flex flex-col gap-1">
            <p className="font-bold text-destructive">
              {t("errors.embeddedServerFailed")}
            </p>
            <p className="text-sm text-muted-foreground">{detail}</p>
          </div>
          <LanguageRow
            label={t("common.language")}
            value={language}
            onChange={handleLanguageChange}
            className="pt-2 border-t border-border"
          />
        </div>
      </div>
    );
  }

  if (
    isElectron() &&
    !isInElectronWebView() &&
    desktopAutoSessionDone === null
  ) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (webviewAuthSuccess || (isInElectronWebView() && webviewAuthSuccess))
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="text-center">
          <CheckCircle2 className="size-12 text-accent-brand mx-auto mb-4" />
          <p className="text-muted-foreground">{t("auth.redirectingToApp")}</p>
        </div>
      </div>
    );

  if (dbConnectionFailed)
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background p-6">
        <div className="flex flex-col gap-5 p-6 border border-border bg-card max-w-sm w-full">
          <div className="flex flex-col gap-1">
            <p className="font-bold text-destructive">
              {t("errors.databaseConnection")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("messages.databaseConnectionFailed")}
            </p>
          </div>
          <Button onClick={() => window.location.reload()}>
            {t("common.refresh")}
          </Button>
          <LanguageRow
            label={t("common.language")}
            value={language}
            onChange={handleLanguageChange}
            className="pt-2 border-t border-border"
          />
        </div>
      </div>
    );

  if (dbHealthChecking)
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );

  if (localDesktopAuth)
    return (
      <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          <div className="hidden lg:flex flex-col w-[420px] shrink-0 bg-sidebar border-r border-border relative overflow-hidden select-none">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(circle, color-mix(in oklch, var(--border) 80%, transparent) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 px-12">
              <span className="text-4xl font-bold tracking-[0.3em] font-mono">
                TERMIX
              </span>
              <div className="w-8 h-px bg-accent-brand" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.25em]">
                {t("auth.tagline")}
              </span>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center p-6 overflow-y-auto relative">
            <div className="w-full max-w-sm flex flex-col gap-6">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <h1 className="text-xl font-bold">
                    {desktopManualLogoutActive
                      ? "Local desktop signed out"
                      : "Local desktop session unavailable"}
                  </h1>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {desktopManualLogoutActive
                      ? "You signed out of the local desktop session. Continue locally to use this device's embedded Termix server again."
                      : "Termix could not create a local desktop session. Retry the embedded local session instead of registering a new account."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={desktopManualLogoutActive ? "outline" : "default"}
                  className="w-full"
                  onClick={continueLocalDesktopSession}
                >
                  {desktopManualLogoutActive
                    ? "Continue with local desktop"
                    : "Retry local desktop session"}
                </Button>
                <Separator />
                <LanguageRow
                  label={t("common.language")}
                  value={language}
                  onChange={handleLanguageChange}
                  className="pt-1"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );

  const TAB_ITEMS: { id: AuthView; label: string; show: boolean }[] = [
    {
      id: "login",
      label: t("common.login"),
      show: passwordLoginAllowed && !firstUser,
    },
    {
      id: "register",
      label: t("common.register"),
      show: (passwordLoginAllowed || firstUser) && registrationAllowed,
    },
    {
      id: "external",
      label: t("auth.external"),
      show: externalMethods.length > 0,
    },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Left decorative panel */}
        <div className="hidden lg:flex flex-col w-[420px] shrink-0 bg-sidebar border-r border-border relative overflow-hidden select-none">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle, color-mix(in oklch, var(--border) 80%, transparent) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 px-12">
            {branding.logo && (
              <img
                src={branding.logo}
                alt=""
                className="w-16 h-16 object-contain mb-1"
              />
            )}
            <span className="text-4xl font-bold tracking-[0.3em] font-mono uppercase">
              {branding.appName}
            </span>
            <div className="w-8 h-px bg-accent-brand" />
            <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.25em]">
              {branding.tagline || t("auth.tagline")}
            </span>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex flex-1 items-center justify-center p-6 overflow-y-auto relative">
          <div className="w-full max-w-sm flex flex-col gap-6">
            {/* TOTP view */}
            {view === "second-factor" && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <h1 className="text-xl font-bold">
                    {t("auth.twoFactorAuth")}
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    {t("auth.enterCode")}
                  </p>
                </div>
                {shownFactors.length > 1 && (
                  <div className="flex border border-border overflow-hidden">
                    {shownFactors.map((factor) => {
                      const ui = secondFactorUIs.find(
                        (candidate) => candidate.id === factor.id,
                      );
                      return (
                        <button
                          key={factor.id}
                          type="button"
                          onClick={() => setActiveFactorId(factor.id)}
                          className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${currentFactorId === factor.id ? "bg-accent-brand text-background" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                        >
                          {ui ? t(ui.titleKey) : factor.id}
                        </button>
                      );
                    })}
                  </div>
                )}
                {(() => {
                  const ui = secondFactorUIs.find(
                    (candidate) => candidate.id === currentFactorId,
                  );
                  if (!ui) {
                    return (
                      <p className="text-xs text-destructive">
                        {t("auth.secondFactorNoUI")}
                      </p>
                    );
                  }
                  const Component = ui.component;
                  return (
                    <Component
                      key={currentFactorId}
                      factorId={currentFactorId}
                      rememberMe={rememberMe}
                      disabled={loading}
                      verify={verifyActiveFactor}
                      challenge={() =>
                        challengeSecondFactor(
                          currentFactorId,
                          pendingToken || undefined,
                        )
                      }
                      cancel={() => switchView("login")}
                    />
                  );
                })()}
              </div>
            )}

            {/* Reset password view */}
            {view === "reset" && (
              <div className="flex flex-col gap-5">
                <button
                  onClick={() => switchView("login")}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
                >
                  <ArrowLeft className="size-3.5" />
                  {t("common.back")}
                </button>
                <div className="flex flex-col gap-1">
                  <h1 className="text-xl font-bold">
                    {t("auth.forgotPassword")}
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    {t("auth.resetCodeDesc")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(["email", "code", "newpass"] as ResetStep[]).map(
                    (step, i) => {
                      const stepIdx = ["email", "code", "newpass"].indexOf(
                        resetStep,
                      );
                      const done = i < stepIdx;
                      const active = i === stepIdx;
                      return (
                        <div
                          key={step}
                          className="flex items-center gap-2 flex-1"
                        >
                          <div
                            className={`size-5 flex items-center justify-center text-[10px] font-bold border transition-colors ${done ? "bg-accent-brand border-accent-brand text-background" : active ? "border-accent-brand text-accent-brand" : "border-border text-muted-foreground"}`}
                          >
                            {done ? <CheckCircle2 className="size-3" /> : i + 1}
                          </div>
                          {i < 2 && (
                            <div
                              className={`h-px flex-1 transition-colors ${done ? "bg-accent-brand" : "bg-border"}`}
                            />
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
                {resetStep === "email" && (
                  <form
                    onSubmit={handleResetInitiate}
                    className="flex flex-col gap-4"
                  >
                    <Field label={t("common.username")} htmlFor="reset-user">
                      <Input
                        id="reset-user"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="your_username"
                        disabled={loading}
                      />
                    </Field>
                    <Button
                      type="submit"
                      className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold"
                      disabled={loading}
                    >
                      {loading ? t("common.loading") : t("auth.sendResetCode")}
                    </Button>
                  </form>
                )}
                {resetStep === "code" && (
                  <form
                    onSubmit={handleResetVerify}
                    className="flex flex-col gap-4"
                  >
                    <Field label={t("auth.resetCode")} htmlFor="reset-code">
                      <Input
                        id="reset-code"
                        value={resetCode}
                        onChange={(e) =>
                          setResetCode(e.target.value.replace(/\D/g, ""))
                        }
                        placeholder="000000"
                        maxLength={6}
                        className="text-center font-mono text-lg tracking-widest"
                        disabled={loading}
                      />
                    </Field>
                    <Button
                      type="submit"
                      className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold"
                      disabled={loading || resetCode.length !== 6}
                    >
                      {loading
                        ? t("common.loading")
                        : t("auth.verifyCodeButton")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full"
                      onClick={() => setResetStep("email")}
                      disabled={loading}
                    >
                      {t("common.back")}
                    </Button>
                  </form>
                )}
                {resetStep === "newpass" && (
                  <form
                    onSubmit={handleResetComplete}
                    className="flex flex-col gap-4"
                  >
                    <Field label={t("auth.newPassword")} htmlFor="new-pass">
                      <PasswordInput
                        id="new-pass"
                        value={newPassword}
                        onChange={setNewPassword}
                        disabled={loading}
                      />
                    </Field>
                    <Field
                      label={t("auth.confirmNewPassword")}
                      htmlFor="confirm-new-pass"
                    >
                      <PasswordInput
                        id="confirm-new-pass"
                        value={confirmNewPassword}
                        onChange={setConfirmNewPassword}
                        disabled={loading}
                      />
                    </Field>
                    <Button
                      type="submit"
                      className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold"
                      disabled={loading}
                    >
                      {loading
                        ? t("common.loading")
                        : t("auth.resetPasswordButton")}
                    </Button>
                  </form>
                )}
              </div>
            )}

            {/* Login / Register / External */}
            {(view === "login" ||
              view === "register" ||
              view === "external") && (
              <div className="flex flex-col gap-5">
                <div className="flex border border-border overflow-hidden">
                  {TAB_ITEMS.filter((item) => item.show).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => switchView(item.id)}
                      className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors ${view === item.id ? "bg-accent-brand text-background" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-1">
                  <h1 className="text-xl font-bold">
                    {view === "login"
                      ? t("auth.loginTitle")
                      : view === "register"
                        ? t("auth.registerTitle")
                        : t("auth.loginWithExternal")}
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    {view === "login"
                      ? t("auth.loginSubtitle", "")
                      : view === "register"
                        ? t("auth.registerSubtitle", "")
                        : t("auth.loginWithExternalDesc")}
                  </p>
                </div>

                {view === "external" && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="rememberSSO"
                        checked={rememberMe}
                        onCheckedChange={(v) => setRememberMe(v === true)}
                      />
                      <label
                        htmlFor="rememberSSO"
                        className="text-xs text-muted-foreground cursor-pointer"
                      >
                        {t("auth.rememberMe")}
                      </label>
                    </div>

                    <div className="flex flex-col gap-3">
                      {externalMethods.map((method) =>
                        renderLoginMethod(method),
                      )}
                      {inlineMethods.map((method) => renderLoginMethod(method))}
                    </div>
                  </div>
                )}

                {view === "login" && (
                  <form onSubmit={handleLogin} className="flex flex-col gap-4">
                    <Field label={t("common.username")} htmlFor="login-user">
                      <div className="relative">
                        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="login-user"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="username"
                          className="pl-8"
                          disabled={loading}
                          autoFocus
                        />
                      </div>
                    </Field>
                    <Field label={t("common.password")} htmlFor="login-pass">
                      <PasswordInput
                        id="login-pass"
                        value={password}
                        onChange={setPassword}
                        disabled={loading}
                      />
                    </Field>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="rememberMe"
                          checked={rememberMe}
                          onCheckedChange={(v) => setRememberMe(v === true)}
                          disabled={loading}
                        />
                        <label
                          htmlFor="rememberMe"
                          className="text-xs text-muted-foreground cursor-pointer"
                        >
                          {t("auth.rememberMe")}
                        </label>
                      </div>
                      {passwordResetAllowed && (
                        <button
                          type="button"
                          onClick={() => switchView("reset")}
                          className="text-xs text-muted-foreground hover:text-accent-brand transition-colors"
                        >
                          {t("auth.forgotPassword")}
                        </button>
                      )}
                    </div>
                    <Button
                      type="submit"
                      className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold h-10"
                      disabled={loading}
                    >
                      {loading ? (
                        t("common.loading")
                      ) : (
                        <span className="flex items-center gap-2">
                          <KeyRound className="size-4" />
                          {t("common.login")}
                        </span>
                      )}
                    </Button>
                    {inlineMethods.map((method) => renderLoginMethod(method))}
                  </form>
                )}

                {view === "register" && (
                  <form
                    onSubmit={handleRegister}
                    className="flex flex-col gap-4"
                  >
                    <Field label={t("common.username")} htmlFor="reg-user">
                      <div className="relative">
                        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="reg-user"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="choose_a_username"
                          className="pl-8"
                          disabled={loading}
                          autoFocus
                        />
                      </div>
                    </Field>
                    <Field label={t("common.password")} htmlFor="reg-pass">
                      <PasswordInput
                        id="reg-pass"
                        value={password}
                        onChange={setPassword}
                        placeholder={t("auth.minChars", {
                          min: 6,
                          defaultValue: "min. 6 characters",
                        })}
                        disabled={loading}
                      />
                    </Field>
                    <Field
                      label={t("common.confirmPassword")}
                      htmlFor="reg-confirm"
                    >
                      <PasswordInput
                        id="reg-confirm"
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        disabled={loading}
                      />
                    </Field>
                    <Button
                      type="submit"
                      className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold h-10"
                      disabled={loading}
                    >
                      {loading ? (
                        t("common.loading")
                      ) : (
                        <span className="flex items-center gap-2">
                          <Shield className="size-4" />
                          {t("auth.signUp")}
                        </span>
                      )}
                    </Button>
                  </form>
                )}

                <Separator />
                <p className="text-center text-xs text-muted-foreground">
                  {view === "login" && registrationAllowed ? (
                    <>
                      {t("auth.noAccount", "Don't have an account?")}{" "}
                      <button
                        onClick={() => switchView("register")}
                        className="text-accent-brand hover:text-accent-brand/70 font-bold transition-colors"
                      >
                        {t("common.register")}
                      </button>
                    </>
                  ) : view === "register" &&
                    passwordLoginAllowed &&
                    !firstUser ? (
                    <>
                      {t("auth.hasAccount", "Already have an account?")}{" "}
                      <button
                        onClick={() => switchView("login")}
                        className="text-accent-brand hover:text-accent-brand/70 font-bold transition-colors"
                      >
                        {t("common.login")}
                      </button>
                    </>
                  ) : null}
                </p>
                <LanguageRow
                  label={t("common.language")}
                  value={language}
                  onChange={handleLanguageChange}
                  className="pt-1"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
