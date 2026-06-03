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
  getOIDCConfig,
  getSetupRequired,
  initiatePasswordReset,
  verifyPasswordResetCode,
  completePasswordReset,
  getOIDCAuthorizeUrl,
  verifyTOTPLogin,
  getServerConfig,
  saveServerConfig,
  isElectron,
  getEmbeddedServerStatus,
  getCurrentToken,
} from "@/main-axios";
import { ElectronServerConfig as ServerConfigComponent } from "@/auth/ElectronServerConfig";
import { ElectronLoginForm } from "@/auth/ElectronLoginForm";
import { Checkbox } from "@/components/checkbox";
import i18n from "@/i18n/i18n";
import {
  removeSilentSigninFromSearch,
  shouldTriggerSilentSignin,
} from "./silent-signin";

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

const STORAGE_KEY = "termix_auth";

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

function storeAuth(username: string) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ loggedIn: true, username }),
  );
}

type AuthView = "login" | "register" | "reset" | "totp" | "external";
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
  const [view, setView] = useState<AuthView>("login");
  const [loading, setLoading] = useState(false);
  const [oidcLoading, setOidcLoading] = useState(false);

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

  const [totpCode, setTotpCode] = useState("");
  const [totpTempToken, setTotpTempToken] = useState("");
  const totpInputRef = useRef<HTMLInputElement>(null);

  const [resetStep, setResetStep] = useState<ResetStep>("email");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resetTempToken, setResetTempToken] = useState("");

  const [language, setLanguage] = useState(
    () => localStorage.getItem("i18nextLng") ?? "en",
  );

  function handleLanguageChange(code: string) {
    setLanguage(code);
    localStorage.setItem("i18nextLng", code);
    i18n.changeLanguage(code);
  }

  const [registrationAllowed, setRegistrationAllowed] = useState(true);
  const [passwordLoginAllowed, setPasswordLoginAllowed] = useState(true);
  const [passwordResetAllowed, setPasswordResetAllowed] = useState(true);
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcConfigLoaded, setOidcConfigLoaded] = useState(false);
  const silentSigninHandledRef = useRef(false);
  const [firstUser, setFirstUser] = useState(false);
  const [dbConnectionFailed, setDbConnectionFailed] = useState(false);
  const [dbHealthChecking, setDbHealthChecking] = useState(true);

  const [showServerConfig, setShowServerConfig] = useState<boolean | null>(
    null,
  );
  const [currentServerUrl, setCurrentServerUrl] = useState("");
  const [webviewAuthSuccess, setWebviewAuthSuccess] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("rememberMe", rememberMe.toString());
    } catch {
      // Ignore storage failures; auth state still works for the current session.
    }
  }, [rememberMe]);

  useEffect(() => {
    getRegistrationAllowed()
      .then((res) => setRegistrationAllowed(res.allowed))
      .catch(() => {});
    getPasswordLoginAllowed()
      .then((res) => setPasswordLoginAllowed(res.allowed))
      .catch(() => {});
    getPasswordResetAllowed()
      .then((allowed) => setPasswordResetAllowed(allowed))
      .catch(() => setPasswordResetAllowed(false));
    getOIDCConfig()
      .then((res) => setOidcConfigured(!!res))
      .catch(() => setOidcConfigured(false))
      .finally(() => setOidcConfigLoaded(true));
  }, []);

  useEffect(() => {
    if (showServerConfig) return;
    setDbHealthChecking(true);
    getSetupRequired()
      .then((res) => {
        if (res.setup_required) {
          setFirstUser(true);
          setView("register");
        }
        setDbConnectionFailed(false);
      })
      .catch(() => setDbConnectionFailed(true))
      .finally(() => setDbHealthChecking(false));
  }, [showServerConfig]);

  useEffect(() => {
    const checkElectron = async () => {
      if (isInElectronWebView()) {
        setShowServerConfig(false);
        return;
      }
      if (isElectron()) {
        try {
          const [config, status] = await Promise.all([
            getServerConfig(),
            getEmbeddedServerStatus(),
          ]);
          if (
            status?.embedded &&
            status?.running &&
            config &&
            !config.serverUrl
          ) {
            setShowServerConfig(false);
            setCurrentServerUrl("");
            return;
          }
          setCurrentServerUrl(config?.serverUrl || "");
          setShowServerConfig(!config || !config.serverUrl);
        } catch {
          setShowServerConfig(true);
        }
      } else {
        setShowServerConfig(false);
      }
    };
    checkElectron();
  }, []);

  useEffect(() => {
    if (view === "totp" && totpInputRef.current) totpInputRef.current.focus();
  }, [view]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get("success");
    const error = urlParams.get("error");
    if (error) {
      if (error === "registration_disabled")
        toast.error(t("messages.registrationDisabled"));
      else if (error === "user_not_allowed")
        toast.error(t("messages.userNotAllowed"));
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
        window.parent.postMessage(
          {
            type: "AUTH_SUCCESS",
            source: "oidc_callback",
            platform: "desktop",
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
        return;
      }
      getUserInfo()
        .then((meRes) => {
          storeAuth(meRes.username || "");
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

  const handleElectronAuthSuccess = useCallback(
    async (token: string | null) => {
      try {
        if (!token) {
          // No token in postMessage — fall back to waiting for the HttpOnly cookie
          const cookieReady = await window.electronAPI?.waitForSessionCookie?.(
            "jwt",
            currentServerUrl,
            null,
            5000,
          );
          if (cookieReady && !cookieReady.success)
            throw new Error(cookieReady.error || "Auth cookie not ready");
        }
        const meRes = await getUserInfo();
        if (!meRes) throw new Error("Failed to get user info");
        storeAuth(meRes.username || "");
        onLogin(
          meRes.username || "",
          meRes.userId || undefined,
          !!meRes.is_admin,
        );
        toast.success(t("messages.loginSuccess"));
      } catch {
        toast.error(t("errors.failedUserInfo"));
      }
    },
    [onLogin, currentServerUrl, t],
  );

  function resetAll() {
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setResetStep("email");
    setResetCode("");
    setNewPassword("");
    setConfirmNewPassword("");
    setResetTempToken("");
    setTotpCode("");
    setTotpTempToken("");
  }

  function switchView(v: AuthView) {
    const currentUsername = username;
    resetAll();
    if (v === "reset") setUsername(currentUsername);
    setView(v);
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
      if (res.requires_totp) {
        setTotpTempToken(res.temp_token);
        setView("totp");
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
        window.parent.postMessage(
          {
            type: "AUTH_SUCCESS",
            source: "auth_component",
            platform: "desktop",
            timestamp: Date.now(),
          },
          "*",
        );
        setWebviewAuthSuccess(true);
        return;
      }
      const meRes = await getUserInfo();
      storeAuth(meRes.username || username.trim());
      toast.success(t("messages.loginSuccess"));
      onLogin(
        meRes.username || username.trim(),
        meRes.userId || undefined,
        !!meRes.is_admin,
      );
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.unknownError"),
      );
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
      if (res.requires_totp) {
        setTotpTempToken(res.temp_token);
        setView("totp");
        return;
      }
      const meRes = await getUserInfo();
      storeAuth(meRes.username || username.trim());
      toast.success(t("messages.registrationSuccess"));
      onLogin(
        meRes.username || username.trim(),
        meRes.userId || undefined,
        !!meRes.is_admin,
      );
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.unknownError"),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleTOTP(e: React.FormEvent) {
    e.preventDefault();
    if (totpCode.length !== 6) {
      toast.error(t("auth.enterCode"));
      return;
    }
    setLoading(true);
    try {
      const res = await verifyTOTPLogin(totpTempToken, totpCode, rememberMe);
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
        window.parent.postMessage(
          {
            type: "AUTH_SUCCESS",
            source: "totp_auth_component",
            platform: "desktop",
            timestamp: Date.now(),
          },
          "*",
        );
        setWebviewAuthSuccess(true);
        return;
      }
      storeAuth(res.username || username);
      toast.success(t("messages.loginSuccess"));
      onLogin(
        res.username || username,
        res.userId || undefined,
        !!res.is_admin,
      );
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string; code?: string } };
      };
      if (error?.response?.data?.code === "SESSION_EXPIRED") {
        setView("login");
        toast.error(t("errors.sessionExpired"));
        return;
      }
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.invalidTotpCode"),
      );
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

  const handleOIDCLogin = useCallback(async () => {
    setOidcLoading(true);
    try {
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
              }>;
            };
          }
        ).electronAPI;
        if (electronAPI?.oidcSystemBrowserAuth) {
          const callbackPort = 17832 + Math.floor(Math.random() * 100);
          const authResponse = await getOIDCAuthorizeUrl(
            rememberMe,
            callbackPort,
          );
          const { auth_url: authUrl } = authResponse;
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
          throw new Error(result.error || "Authentication failed");
        }
      }
      const authResponse = await getOIDCAuthorizeUrl(rememberMe);
      const { auth_url: authUrl } = authResponse;
      if (!authUrl || authUrl === "undefined")
        throw new Error(t("errors.invalidAuthUrl"));
      window.location.replace(authUrl);
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.failedOidcLogin"),
      );
      setOidcLoading(false);
    }
  }, [rememberMe, t]);

  useEffect(() => {
    if (!oidcConfigLoaded || silentSigninHandledRef.current) return;
    if (!shouldTriggerSilentSignin(window.location.search)) return;

    const nextSearch = removeSilentSigninFromSearch(window.location.search);
    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}${nextSearch}${window.location.hash}`,
    );

    silentSigninHandledRef.current = true;
    if (oidcConfigured && !isElectron()) {
      handleOIDCLogin();
      return;
    }

    toast.info(t("errors.silentSigninOidcUnavailable"));
  }, [handleOIDCLogin, oidcConfigLoaded, oidcConfigured, t]);

  // Electron server config / webview auth success screens
  if (isElectron() && !isInElectronWebView()) {
    if (showServerConfig === null)
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-background">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      );
    if (showServerConfig)
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-background p-6">
          <div className="w-full max-w-md">
            <ServerConfigComponent
              onServerConfigured={() => window.location.reload()}
              onUseEmbedded={async () => {
                await saveServerConfig({
                  serverUrl: "",
                  lastUpdated: new Date().toISOString(),
                });
                setShowServerConfig(false);
                setCurrentServerUrl("");
              }}
              onCancel={() => setShowServerConfig(false)}
              isFirstTime={!currentServerUrl}
            />
          </div>
        </div>
      );
    if (!webviewAuthSuccess && showServerConfig === false && currentServerUrl)
      return (
        <div className="w-full h-screen flex items-center justify-center p-4 bg-background">
          <div className="w-full max-w-4xl h-[90vh]">
            <ElectronLoginForm
              serverUrl={currentServerUrl}
              onAuthSuccess={handleElectronAuthSuccess}
              onChangeServer={() => setShowServerConfig(true)}
            />
          </div>
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
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-xs text-muted-foreground">
              {t("common.language")}
            </span>
            <select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
          {isElectron() && currentServerUrl && (
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  {t("serverConfig.serverUrl")}
                </span>
                <span className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                  {currentServerUrl}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowServerConfig(true)}
              >
                {t("common.edit")}
              </Button>
            </div>
          )}
        </div>
      </div>
    );

  if (dbHealthChecking && showServerConfig === false)
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
    { id: "external", label: t("auth.external"), show: oidcConfigured },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
      {isElectron() && !isInElectronWebView() && showServerConfig === false && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <button
            onClick={() => setShowServerConfig(true)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            {t("serverConfig.changeServer")}
          </button>
          <span className="text-xs text-muted-foreground">
            {t("serverConfig.localServer")}
          </span>
          <div className="w-20" />
        </div>
      )}
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
            <span className="text-4xl font-bold tracking-[0.3em] font-mono">
              TERMIX
            </span>
            <div className="w-8 h-px bg-accent-brand" />
            <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.25em]">
              {t("auth.tagline")}
            </span>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex flex-1 items-center justify-center p-6 overflow-y-auto relative">
          <div className="w-full max-w-sm flex flex-col gap-6">
            {/* TOTP view */}
            {view === "totp" && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <h1 className="text-xl font-bold">
                    {t("auth.twoFactorAuth")}
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    {t("auth.enterCode")}
                  </p>
                </div>
                <form onSubmit={handleTOTP} className="flex flex-col gap-4">
                  <Field label={t("auth.verifyCode")} htmlFor="totp-code">
                    <Input
                      ref={totpInputRef}
                      id="totp-code"
                      type="text"
                      placeholder="000000"
                      maxLength={6}
                      value={totpCode}
                      onChange={(e) =>
                        setTotpCode(e.target.value.replace(/\D/g, ""))
                      }
                      disabled={loading}
                      className="text-center text-2xl tracking-widest font-mono"
                      autoComplete="one-time-code"
                    />
                  </Field>
                  <Button
                    type="submit"
                    className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold"
                    disabled={loading || totpCode.length !== 6}
                  >
                    {loading ? t("common.loading") : t("auth.verifyCode")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => switchView("login")}
                    disabled={loading}
                  >
                    {t("common.cancel")}
                  </Button>
                </form>
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
                    {isElectron() ? (
                      <p className="text-xs text-muted-foreground text-center">
                        {t("auth.externalNotSupportedInElectron")}
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="rememberOIDC"
                            checked={rememberMe}
                            onCheckedChange={(v) => setRememberMe(v === true)}
                          />
                          <label
                            htmlFor="rememberOIDC"
                            className="text-xs text-muted-foreground cursor-pointer"
                          >
                            {t("auth.rememberMe")}
                          </label>
                        </div>
                        <Button
                          onClick={handleOIDCLogin}
                          disabled={oidcLoading}
                          className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold"
                        >
                          {oidcLoading
                            ? t("common.loading")
                            : t("auth.loginWithExternal")}
                        </Button>
                      </>
                    )}
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
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    {t("common.language")}
                  </span>
                  <select
                    value={language}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring"
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
