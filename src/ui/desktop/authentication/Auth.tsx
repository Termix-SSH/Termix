import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs.tsx";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/ui/desktop/user/LanguageSwitcher.tsx";
import { toast } from "sonner";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import {
  registerUser,
  loginUser,
  getUserInfo,
  getRegistrationAllowed,
  getPasswordLoginAllowed,
  getOIDCConfig,
  getSetupRequired,
  initiatePasswordReset,
  verifyPasswordResetCode,
  completePasswordReset,
  getOIDCAuthorizeUrl,
  verifyTOTPLogin,
  getServerConfig,
  isElectron,
} from "../../main-axios.ts";
import { ElectronServerConfig as ServerConfigComponent } from "@/ui/desktop/authentication/ElectronServerConfig.tsx";
import { ElectronLoginForm } from "@/ui/desktop/authentication/ElectronLoginForm.tsx";

function getCookie(name: string): string | undefined {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift();
}

interface ExtendedWindow extends Window {
  IS_ELECTRON_WEBVIEW?: boolean;
}

interface AuthProps extends React.ComponentProps<"div"> {
  setLoggedIn: (loggedIn: boolean) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setUsername: (username: string | null) => void;
  setUserId: (userId: string | null) => void;
  loggedIn: boolean;
  authLoading: boolean;
  setDbError: (error: string | null) => void;
  onAuthSuccess: (authData: {
    isAdmin: boolean;
    username: string | null;
    userId: string | null;
  }) => void;
}

export function Auth({
  className,
  setLoggedIn,
  setIsAdmin,
  setUsername,
  setUserId,
  loggedIn,
  authLoading,
  setDbError,
  onAuthSuccess,
  ...props
}: AuthProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const isDarkMode =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const lineColor = isDarkMode ? "#151517" : "#f9f9f9";

  const isInElectronWebView = () => {
    if ((window as ExtendedWindow).IS_ELECTRON_WEBVIEW) {
      return true;
    }
    try {
      if (window.self !== window.top) {
        return true;
      }
    } catch (_e) {
      return false;
    }
    return false;
  };

  const [tab, setTab] = useState<"login" | "signup" | "external" | "reset">(
    "login",
  );
  const [localUsername, setLocalUsername] = useState("");
  const [password, setPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oidcLoading, setOidcLoading] = useState(false);
  const [internalLoggedIn, setInternalLoggedIn] = useState(false);
  const [firstUser, setFirstUser] = useState(false);
  const [firstUserToastShown, setFirstUserToastShown] = useState(false);
  const [registrationAllowed, setRegistrationAllowed] = useState(true);
  const [passwordLoginAllowed, setPasswordLoginAllowed] = useState(true);
  const [oidcConfigured, setOidcConfigured] = useState(false);

  const [resetStep, setResetStep] = useState<
    "initiate" | "verify" | "newPassword"
  >("initiate");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [totpTempToken, setTotpTempToken] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const [webviewAuthSuccess, setWebviewAuthSuccess] = useState(false);
  const totpInputRef = React.useRef<HTMLInputElement>(null);

  const [showServerConfig, setShowServerConfig] = useState<boolean | null>(
    null,
  );
  const [currentServerUrl, setCurrentServerUrl] = useState<string>("");
  const [dbConnectionFailed, setDbConnectionFailed] = useState(false);
  const [dbHealthChecking, setDbHealthChecking] = useState(false);

  const handleElectronAuthSuccess = useCallback(async () => {
    try {
      const meRes = await getUserInfo();
      setInternalLoggedIn(true);
      setLoggedIn(true);
      setIsAdmin(!!meRes.is_admin);
      setUsername(meRes.username || null);
      setUserId(meRes.userId || null);
      onAuthSuccess({
        isAdmin: !!meRes.is_admin,
        username: meRes.username || null,
        userId: meRes.userId || null,
      });
      toast.success(t("messages.loginSuccess"));
    } catch (_err) {
      toast.error(t("errors.failedUserInfo"));
    }
  }, [
    onAuthSuccess,
    setLoggedIn,
    setIsAdmin,
    setUsername,
    setUserId,
    t,
    setInternalLoggedIn,
  ]);

  useEffect(() => {
    setInternalLoggedIn(loggedIn);
  }, [loggedIn]);

  useEffect(() => {
    if (totpRequired && totpInputRef.current) {
      totpInputRef.current.focus();
    }
  }, [totpRequired]);

  useEffect(() => {
    getRegistrationAllowed().then((res) => {
      setRegistrationAllowed(res.allowed);
    });
  }, []);

  useEffect(() => {
    getPasswordLoginAllowed()
      .then((res) => {
        setPasswordLoginAllowed(res.allowed);
      })
      .catch((err) => {
        if (err.code !== "NO_SERVER_CONFIGURED") {
          console.error("Failed to fetch password login status:", err);
        }
      });
  }, []);

  useEffect(() => {
    getOIDCConfig()
      .then((response) => {
        if (response) {
          setOidcConfigured(true);
        } else {
          setOidcConfigured(false);
        }
      })
      .catch((error) => {
        if (error.response?.status === 404) {
          setOidcConfigured(false);
        } else {
          setOidcConfigured(false);
        }
      });
  }, []);

  useEffect(() => {
    if (showServerConfig) {
      return;
    }

    setDbHealthChecking(true);
    getSetupRequired()
      .then((res) => {
        if (res.setup_required) {
          setFirstUser(true);
          setTab("signup");
          if (!firstUserToastShown) {
            toast.info(t("auth.firstUserMessage"));
            setFirstUserToastShown(true);
          }
        } else {
          setFirstUser(false);
        }
        setDbError(null);
        setDbConnectionFailed(false);
      })
      .catch(() => {
        setDbConnectionFailed(true);
      })
      .finally(() => {
        setDbHealthChecking(false);
      });
  }, [setDbError, firstUserToastShown, showServerConfig, t]);

  useEffect(() => {
    if (!registrationAllowed && !internalLoggedIn) {
      toast.warning(t("messages.registrationDisabled"));
    }
  }, [registrationAllowed, internalLoggedIn, t]);

  useEffect(() => {
    if (!passwordLoginAllowed && oidcConfigured && tab !== "external") {
      setTab("external");
    }
  }, [passwordLoginAllowed, oidcConfigured, tab]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    if (!localUsername.trim()) {
      toast.error(t("errors.requiredField"));
      setLoading(false);
      return;
    }

    if (!passwordLoginAllowed && !firstUser) {
      toast.error(t("errors.passwordLoginDisabled"));
      setLoading(false);
      return;
    }

    try {
      let res;
      if (tab === "login") {
        res = await loginUser(localUsername, password);
      } else {
        if (password !== signupConfirmPassword) {
          toast.error(t("errors.passwordMismatch"));
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          toast.error(t("errors.minLength", { min: 6 }));
          setLoading(false);
          return;
        }

        await registerUser(localUsername, password);
        res = await loginUser(localUsername, password);
      }

      if (res.requires_totp) {
        setTotpRequired(true);
        setTotpTempToken(res.temp_token);
        setLoading(false);
        return;
      }

      if (!res || !res.success) {
        throw new Error(t("errors.loginFailed"));
      }

      if (isInElectronWebView() && res.token) {
        try {
          localStorage.setItem("jwt", res.token);
          window.parent.postMessage(
            {
              type: "AUTH_SUCCESS",
              token: res.token,
              source: "auth_component",
              platform: "desktop",
              timestamp: Date.now(),
            },
            "*",
          );
          setWebviewAuthSuccess(true);
          setTimeout(() => window.location.reload(), 100);
        } catch (e) {
          console.error("Error posting auth success message:", e);
        }
      }

      const [meRes] = await Promise.all([getUserInfo()]);

      setInternalLoggedIn(true);
      setLoggedIn(true);
      setIsAdmin(!!meRes.is_admin);
      setUsername(meRes.username || null);
      setUserId(meRes.userId || null);
      setDbError(null);
      onAuthSuccess({
        isAdmin: !!meRes.is_admin,
        username: meRes.username || null,
        userId: meRes.userId || null,
      });
      setInternalLoggedIn(true);
      if (tab === "signup") {
        setSignupConfirmPassword("");
        toast.success(t("messages.registrationSuccess"));
      } else {
        toast.success(t("messages.loginSuccess"));
      }
      setTotpRequired(false);
      setTotpCode("");
      setTotpTempToken("");
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      const errorMessage =
        error?.response?.data?.error ||
        error?.message ||
        t("errors.unknownError");
      toast.error(errorMessage);
      setInternalLoggedIn(false);
      setLoggedIn(false);
      setIsAdmin(false);
      setUsername(null);
      setUserId(null);
      if (error?.response?.data?.error?.includes("Database")) {
        setDbConnectionFailed(true);
      } else {
        setDbError(null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleInitiatePasswordReset() {
    setResetLoading(true);
    try {
      await initiatePasswordReset(localUsername);
      setResetStep("verify");
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
      setResetLoading(false);
    }
  }

  async function handleVerifyResetCode() {
    setResetLoading(true);
    try {
      const response = await verifyPasswordResetCode(localUsername, resetCode);
      setTempToken(response.tempToken);
      setResetStep("newPassword");
      toast.success(t("messages.codeVerified"));
    } catch (err: unknown) {
      const error = err as {
        response?: {
          data?: {
            error?: string;
            code?: string;
            remainingTime?: number;
            remainingAttempts?: number;
          };
        };
      };
      const errorCode = error?.response?.data?.code;
      const remainingTime = error?.response?.data?.remainingTime;
      const remainingAttempts = error?.response?.data?.remainingAttempts;

      let errorMessage =
        error?.response?.data?.error || t("errors.failedVerifyCode");

      if (errorCode === "RESET_CODE_RATE_LIMITED") {
        if (remainingTime) {
          errorMessage = t("errors.resetCodeRateLimitedWithTime", {
            time: remainingTime,
          });
        } else {
          errorMessage = t("errors.resetCodeRateLimited");
        }
      } else if (
        remainingAttempts !== undefined &&
        remainingAttempts <= 2 &&
        remainingAttempts > 0
      ) {
        errorMessage = `${errorMessage} (${remainingAttempts} ${t("auth.attemptsRemaining")})`;
      }

      toast.error(errorMessage);
    } finally {
      setResetLoading(false);
    }
  }

  async function handleCompletePasswordReset() {
    setResetLoading(true);

    if (newPassword !== confirmPassword) {
      toast.error(t("errors.passwordMismatch"));
      setResetLoading(false);
      return;
    }

    if (newPassword.length < 6) {
      toast.error(t("errors.minLength", { min: 6 }));
      setResetLoading(false);
      return;
    }

    try {
      await completePasswordReset(localUsername, tempToken, newPassword);

      setResetStep("initiate");
      setResetCode("");
      setNewPassword("");
      setConfirmPassword("");
      setTempToken("");

      setResetSuccess(true);
      toast.success(t("messages.passwordResetSuccess"));

      setTab("login");
      resetPasswordState();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(
        error?.response?.data?.error || t("errors.failedCompleteReset"),
      );
    } finally {
      setResetLoading(false);
    }
  }

  function resetPasswordState() {
    setResetStep("initiate");
    setResetCode("");
    setNewPassword("");
    setConfirmPassword("");
    setTempToken("");
    setResetSuccess(false);
    setSignupConfirmPassword("");
  }

  function clearFormFields() {
    setPassword("");
    setSignupConfirmPassword("");
  }

  async function handleTOTPVerification() {
    if (totpCode.length !== 6) {
      toast.error(t("auth.enterCode"));
      return;
    }

    setTotpLoading(true);

    try {
      const res = await verifyTOTPLogin(totpTempToken, totpCode);

      if (!res || !res.success) {
        throw new Error(t("errors.loginFailed"));
      }

      if (isElectron() && res.token) {
        localStorage.setItem("jwt", res.token);
      }

      if (isInElectronWebView() && res.token) {
        try {
          localStorage.setItem("jwt", res.token);
          window.parent.postMessage(
            {
              type: "AUTH_SUCCESS",
              token: res.token,
              source: "totp_auth_component",
              platform: "desktop",
              timestamp: Date.now(),
            },
            "*",
          );
          setWebviewAuthSuccess(true);
          setTimeout(() => window.location.reload(), 100);
          setTotpLoading(false);
          return;
        } catch (e) {
          console.error("Error posting auth success message:", e);
        }
      }

      setLoggedIn(true);
      setIsAdmin(!!res.is_admin);
      setUsername(res.username || null);
      setUserId(res.userId || null);
      setDbError(null);

      onAuthSuccess({
        isAdmin: !!res.is_admin,
        username: res.username || null,
        userId: res.userId || null,
      });

      setInternalLoggedIn(true);
      setTotpRequired(false);
      setTotpCode("");
      setTotpTempToken("");
      toast.success(t("messages.loginSuccess"));
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: {
          data?: {
            code?: string;
            error?: string;
            remainingTime?: number;
            remainingAttempts?: number;
          };
        };
      };
      const errorCode = error?.response?.data?.code;
      const remainingTime = error?.response?.data?.remainingTime;
      const remainingAttempts = error?.response?.data?.remainingAttempts;

      let errorMessage =
        error?.response?.data?.error ||
        error?.message ||
        t("errors.invalidTotpCode");

      if (errorCode === "SESSION_EXPIRED") {
        setTotpRequired(false);
        setTotpCode("");
        setTotpTempToken("");
        setTab("login");
        toast.error(t("errors.sessionExpired"));
      } else if (errorCode === "TOTP_RATE_LIMITED") {
        if (remainingTime) {
          errorMessage = t("errors.totpRateLimitedWithTime", {
            time: remainingTime,
          });
        } else {
          errorMessage = t("errors.totpRateLimited");
        }
        toast.error(errorMessage);
      } else {
        if (
          remainingAttempts !== undefined &&
          remainingAttempts <= 2 &&
          remainingAttempts > 0
        ) {
          errorMessage = `${errorMessage} (${remainingAttempts} ${t("auth.attemptsRemaining")})`;
        }
        toast.error(errorMessage);
      }
    } finally {
      setTotpLoading(false);
    }
  }

  async function handleOIDCLogin() {
    setOidcLoading(true);
    try {
      const authResponse = await getOIDCAuthorizeUrl();
      const { auth_url: authUrl } = authResponse;

      if (!authUrl || authUrl === "undefined") {
        throw new Error(t("errors.invalidAuthUrl"));
      }

      window.location.replace(authUrl);
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      const errorMessage =
        error?.response?.data?.error ||
        error?.message ||
        t("errors.failedOidcLogin");
      toast.error(errorMessage);
      setOidcLoading(false);
    }
  }

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get("success");
    const error = urlParams.get("error");

    if (error) {
      if (error === "registration_disabled") {
        toast.error(t("messages.registrationDisabled"));
      } else {
        toast.error(`${t("errors.oidcAuthFailed")}: ${error}`);
      }
      setOidcLoading(false);
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (success) {
      setOidcLoading(true);

      getUserInfo()
        .then((meRes) => {
          if (isInElectronWebView()) {
            const token = getCookie("jwt") || localStorage.getItem("jwt");
            if (token) {
              try {
                window.parent.postMessage(
                  {
                    type: "AUTH_SUCCESS",
                    token: token,
                    source: "oidc_callback",
                    platform: "desktop",
                    timestamp: Date.now(),
                  },
                  "*",
                );
                setWebviewAuthSuccess(true);
                setTimeout(() => window.location.reload(), 100);
                setOidcLoading(false);
                return;
              } catch (e) {
                console.error("Error posting auth success message:", e);
              }
            }
          }

          setInternalLoggedIn(true);
          setLoggedIn(true);
          setIsAdmin(!!meRes.is_admin);
          setUsername(meRes.username || null);
          setUserId(meRes.userId || null);
          setDbError(null);
          onAuthSuccess({
            isAdmin: !!meRes.is_admin,
            username: meRes.username || null,
            userId: meRes.userId || null,
          });
          setInternalLoggedIn(true);
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        })
        .catch(() => {
          setInternalLoggedIn(false);
          setLoggedIn(false);
          setIsAdmin(false);
          setUsername(null);
          setUserId(null);
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        })
        .finally(() => {
          setOidcLoading(false);
        });
    }
  }, [
    onAuthSuccess,
    setDbError,
    setIsAdmin,
    setLoggedIn,
    setUserId,
    setUsername,
    t,
    isInElectronWebView,
  ]);

  const Spinner = (
    <svg
      className="animate-spin mr-2 h-4 w-4 text-foreground inline-block"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );

  useEffect(() => {
    if (dbConnectionFailed) {
      toast.error(t("errors.databaseConnection"));
    }
  }, [dbConnectionFailed, t]);

  useEffect(() => {
    const checkServerConfig = async () => {
      if (isInElectronWebView()) {
        setShowServerConfig(false);
        return;
      }

      if (isElectron()) {
        try {
          const config = await getServerConfig();
          setCurrentServerUrl(config?.serverUrl || "");
          setShowServerConfig(!config || !config.serverUrl);
        } catch {
          setShowServerConfig(true);
        }
      } else {
        setShowServerConfig(false);
      }
    };

    checkServerConfig();
  }, []);

  if (showServerConfig === null && !isInElectronWebView()) {
    return (
      <div
        className={`w-[420px] max-w-full p-6 flex flex-col bg-canvas border-2 border-edge rounded-md overflow-y-auto thin-scrollbar my-2 animate-in fade-in zoom-in-95 duration-300 ${className || ""}`}
        style={{ maxHeight: "calc(100vh - 1rem)" }}
        {...props}
      >
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (showServerConfig && !isInElectronWebView()) {
    return (
      <div
        className={`w-[420px] max-w-full p-6 flex flex-col bg-canvas border-2 border-edge rounded-md overflow-y-auto thin-scrollbar my-2 animate-in fade-in zoom-in-95 duration-300 ${className || ""}`}
        style={{ maxHeight: "calc(100vh - 1rem)" }}
        {...props}
      >
        <ServerConfigComponent
          onServerConfigured={() => {
            window.location.reload();
          }}
          onCancel={() => {
            setShowServerConfig(false);
          }}
          isFirstTime={!currentServerUrl}
        />
      </div>
    );
  }

  if (
    isElectron() &&
    currentServerUrl &&
    authLoading &&
    !isInElectronWebView()
  ) {
    return (
      <div
        className={`fixed inset-0 flex items-center justify-center ${className || ""}`}
        style={{
          background: "var(--bg-elevated)",
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 35px,
            ${lineColor} 35px,
            ${lineColor} 37px
          )`,
        }}
        {...props}
      >
        <div className="w-[420px] max-w-full p-8 flex flex-col backdrop-blur-sm bg-card/50 rounded-2xl shadow-xl border-2 border-edge overflow-y-auto thin-scrollbar my-2 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">
                {t("common.checkingAuthentication")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isElectron() && currentServerUrl && !loggedIn && !isInElectronWebView()) {
    return (
      <div
        className="w-full h-screen flex items-center justify-center p-4"
        {...props}
      >
        <div className="w-full max-w-4xl h-[90vh]">
          <ElectronLoginForm
            serverUrl={currentServerUrl}
            onAuthSuccess={handleElectronAuthSuccess}
            onChangeServer={() => {
              setShowServerConfig(true);
            }}
          />
        </div>
      </div>
    );
  }

  if (dbHealthChecking && !dbConnectionFailed) {
    return (
      <div
        className={`fixed inset-0 flex items-center justify-center ${className || ""}`}
        style={{
          background: "var(--bg-elevated)",
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 35px,
            ${lineColor} 35px,
            ${lineColor} 37px
          )`,
        }}
        {...props}
      >
        <div className="w-[420px] max-w-full p-8 flex flex-col backdrop-blur-sm bg-card/50 rounded-2xl shadow-xl border-2 border-edge overflow-y-auto thin-scrollbar my-2 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">
                {t("common.checkingDatabase")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (dbConnectionFailed) {
    return (
      <div
        className={`fixed inset-0 flex items-center justify-center ${className || ""}`}
        style={{
          background: "var(--bg-elevated)",
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 35px,
            ${lineColor} 35px,
            ${lineColor} 37px
          )`,
        }}
        {...props}
      >
        <div
          className="w-[420px] max-w-full p-8 flex flex-col backdrop-blur-sm bg-card/50 rounded-2xl shadow-xl border-2 border-edge overflow-y-auto thin-scrollbar my-2 animate-in fade-in zoom-in-95 duration-300"
          style={{ maxHeight: "calc(100vh - 1rem)" }}
        >
          <div className="mb-6 text-center">
            <h2 className="text-xl font-bold mb-1">
              {t("errors.databaseConnection")}
            </h2>
            <p className="text-muted-foreground">
              {t("messages.databaseConnectionFailed")}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 text-base font-semibold"
              disabled={dbHealthChecking}
              onClick={() => window.location.reload()}
            >
              {t("common.refresh")}
            </Button>
          </div>

          <div className="mt-6 pt-4 border-t border-edge space-y-4">
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  const isDark =
                    theme === "dark" ||
                    (theme === "system" &&
                      window.matchMedia("(prefers-color-scheme: dark)")
                        .matches);
                  setTheme(isDark ? "light" : "dark");
                }}
              >
                {theme === "dark" ||
                (theme === "system" &&
                  window.matchMedia("(prefers-color-scheme: dark)").matches) ? (
                  <Moon className="w-4 h-4" />
                ) : (
                  <Sun className="w-4 h-4" />
                )}
              </Button>
              <LanguageSwitcher />
            </div>
            {isElectron() && currentServerUrl && (
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm text-muted-foreground">
                    Server
                  </Label>
                  <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {currentServerUrl}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowServerConfig(true)}
                  className="h-8 px-3"
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center ${className || ""}`}
      {...props}
    >
      <div className="w-full h-full flex flex-col md:flex-row">
        <div
          className="hidden md:flex md:w-2/5 items-center justify-center relative border-r-2 border-edge"
          style={{
            background: "var(--bg-elevated)",
            backgroundImage: `repeating-linear-gradient(
              45deg,
              transparent,
              transparent 35px,
              ${lineColor} 35px,
              ${lineColor} 37px
            )`,
          }}
        >
          <div className="relative text-center px-8">
            <div
              className="text-7xl font-bold tracking-wider mb-4 text-foreground"
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              }}
            >
              {t("common.appName").toUpperCase()}
            </div>
            <div className="text-lg text-muted-foreground tracking-widest font-light">
              {t("auth.tagline")}
            </div>
          </div>
        </div>

        <div className="flex-1 flex p-6 md:p-12 bg-background overflow-y-auto thin-scrollbar">
          <div className="m-auto w-full max-w-md backdrop-blur-sm bg-card/50 rounded-2xl p-8 shadow-xl border-2 border-edge animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col">
            {isInElectronWebView() && !webviewAuthSuccess && (
              <Alert className="mb-4 border-blue-500 bg-blue-500/10">
                <Monitor className="h-4 w-4" />
                <AlertTitle>{t("auth.desktopApp")}</AlertTitle>
                <AlertDescription>
                  {t("auth.loggingInToDesktopApp")}
                </AlertDescription>
              </Alert>
            )}
            {isInElectronWebView() && webviewAuthSuccess && (
              <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="text-center">
                  <h2 className="text-xl font-bold mb-2">
                    {t("messages.loginSuccess")}
                  </h2>
                  <p className="text-muted-foreground">
                    {t("auth.redirectingToApp")}
                  </p>
                </div>
              </div>
            )}
            {!webviewAuthSuccess && totpRequired && (
              <div className="flex flex-col gap-5">
                <div className="mb-6 text-center">
                  <h2 className="text-xl font-bold mb-1">
                    {t("auth.twoFactorAuth")}
                  </h2>
                  <p className="text-muted-foreground">{t("auth.enterCode")}</p>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="totp-code">{t("auth.verifyCode")}</Label>
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
                    disabled={totpLoading}
                    className="text-center text-2xl tracking-widest font-mono"
                    autoComplete="one-time-code"
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    {t("auth.backupCode")}
                  </p>
                </div>

                <Button
                  type="button"
                  className="w-full h-11 text-base font-semibold"
                  disabled={totpLoading || totpCode.length < 6}
                  onClick={handleTOTPVerification}
                >
                  {totpLoading ? Spinner : t("auth.verifyCode")}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 text-base font-semibold"
                  disabled={totpLoading}
                  onClick={() => {
                    setTotpRequired(false);
                    setTotpCode("");
                    setTotpTempToken("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            )}

            {!webviewAuthSuccess &&
              !loggedIn &&
              !authLoading &&
              !totpRequired && (
                <>
                  {(() => {
                    const hasLogin = passwordLoginAllowed && !firstUser;
                    const hasSignup =
                      (passwordLoginAllowed || firstUser) &&
                      registrationAllowed;
                    const hasOIDC = oidcConfigured;
                    const hasAnyAuth = hasLogin || hasSignup || hasOIDC;

                    if (!hasAnyAuth) {
                      return (
                        <div className="text-center">
                          <h2 className="text-xl font-bold mb-1">
                            {t("auth.authenticationDisabled")}
                          </h2>
                          <p className="text-muted-foreground">
                            {t("auth.authenticationDisabledDesc")}
                          </p>
                        </div>
                      );
                    }

                    return (
                      <>
                        <Tabs
                          value={tab}
                          onValueChange={(value) => {
                            const newTab = value as
                              | "login"
                              | "signup"
                              | "external"
                              | "reset";
                            setTab(newTab);
                            if (tab === "reset") resetPasswordState();
                            if (
                              (tab === "login" && newTab === "signup") ||
                              (tab === "signup" && newTab === "login")
                            ) {
                              clearFormFields();
                            }
                          }}
                          className="w-full mb-8"
                        >
                          <TabsList className="w-full">
                            {passwordLoginAllowed && (
                              <TabsTrigger
                                value="login"
                                disabled={loading || firstUser}
                                className="flex-1"
                              >
                                {t("common.login")}
                              </TabsTrigger>
                            )}
                            {(passwordLoginAllowed || firstUser) &&
                              registrationAllowed && (
                                <TabsTrigger
                                  value="signup"
                                  disabled={loading}
                                  className="flex-1"
                                >
                                  {t("common.register")}
                                </TabsTrigger>
                              )}
                            {oidcConfigured && (
                              <TabsTrigger
                                value="external"
                                disabled={oidcLoading}
                                className="flex-1"
                              >
                                {t("auth.external")}
                              </TabsTrigger>
                            )}
                          </TabsList>
                        </Tabs>

                        <div className="mb-8 text-center">
                          <h2 className="text-2xl font-bold">
                            {tab === "login"
                              ? t("auth.loginTitle")
                              : tab === "signup"
                                ? t("auth.registerTitle")
                                : tab === "external"
                                  ? t("auth.loginWithExternal")
                                  : t("auth.forgotPassword")}
                          </h2>
                        </div>

                        {tab === "external" || tab === "reset" ? (
                          <div className="flex flex-col gap-5">
                            {tab === "external" && (
                              <>
                                <div className="text-center text-muted-foreground mb-4">
                                  <p>{t("auth.loginWithExternalDesc")}</p>
                                </div>
                                {(() => {
                                  if (isElectron()) {
                                    return (
                                      <div className="text-center p-4 bg-muted/50 rounded-lg border">
                                        <p className="text-muted-foreground text-sm">
                                          {t(
                                            "auth.externalNotSupportedInElectron",
                                          )}
                                        </p>
                                      </div>
                                    );
                                  } else {
                                    return (
                                      <Button
                                        type="button"
                                        className="w-full h-11 mt-2 text-base font-semibold"
                                        disabled={oidcLoading}
                                        onClick={handleOIDCLogin}
                                      >
                                        {oidcLoading
                                          ? Spinner
                                          : t("auth.loginWithExternal")}
                                      </Button>
                                    );
                                  }
                                })()}
                              </>
                            )}
                            {tab === "reset" && (
                              <>
                                {resetStep === "initiate" && (
                                  <>
                                    <Alert
                                      variant="destructive"
                                      className="mb-4"
                                    >
                                      <AlertTitle>
                                        {t("common.warning")}
                                      </AlertTitle>
                                      <AlertDescription>
                                        {t("auth.dataLossWarning")}
                                      </AlertDescription>
                                    </Alert>
                                    <div className="text-center text-muted-foreground mb-4">
                                      <p>{t("auth.resetCodeDesc")}</p>
                                    </div>
                                    <div className="flex flex-col gap-4">
                                      <div className="flex flex-col gap-2">
                                        <Label htmlFor="reset-username">
                                          {t("common.username")}
                                        </Label>
                                        <Input
                                          id="reset-username"
                                          type="text"
                                          required
                                          className="h-11 text-base"
                                          value={localUsername}
                                          onChange={(e) =>
                                            setLocalUsername(e.target.value)
                                          }
                                          disabled={resetLoading}
                                        />
                                      </div>
                                      <Button
                                        type="button"
                                        className="w-full h-11 text-base font-semibold"
                                        disabled={
                                          resetLoading || !localUsername.trim()
                                        }
                                        onClick={handleInitiatePasswordReset}
                                      >
                                        {resetLoading
                                          ? Spinner
                                          : t("auth.sendResetCode")}
                                      </Button>
                                    </div>
                                  </>
                                )}

                                {resetStep === "verify" && (
                                  <>
                                    <div className="text-center text-muted-foreground mb-4">
                                      <p>
                                        {t("auth.enterResetCode")}{" "}
                                        <strong>{localUsername}</strong>
                                      </p>
                                    </div>
                                    <div className="flex flex-col gap-4">
                                      <div className="flex flex-col gap-2">
                                        <Label htmlFor="reset-code">
                                          {t("auth.resetCode")}
                                        </Label>
                                        <Input
                                          id="reset-code"
                                          type="text"
                                          required
                                          maxLength={6}
                                          className="h-11 text-base text-center text-lg tracking-widest"
                                          value={resetCode}
                                          onChange={(e) =>
                                            setResetCode(
                                              e.target.value.replace(/\D/g, ""),
                                            )
                                          }
                                          disabled={resetLoading}
                                          placeholder="000000"
                                        />
                                      </div>
                                      <Button
                                        type="button"
                                        className="w-full h-11 text-base font-semibold"
                                        disabled={
                                          resetLoading || resetCode.length !== 6
                                        }
                                        onClick={handleVerifyResetCode}
                                      >
                                        {resetLoading
                                          ? Spinner
                                          : t("auth.verifyCodeButton")}
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full h-11 text-base font-semibold"
                                        disabled={resetLoading}
                                        onClick={() => {
                                          setResetStep("initiate");
                                          setResetCode("");
                                        }}
                                      >
                                        {t("common.back")}
                                      </Button>
                                    </div>
                                  </>
                                )}

                                {resetStep === "newPassword" &&
                                  !resetSuccess && (
                                    <>
                                      <div className="text-center text-muted-foreground mb-4">
                                        <p>
                                          {t("auth.enterNewPassword")}{" "}
                                          <strong>{localUsername}</strong>
                                        </p>
                                      </div>
                                      <div className="flex flex-col gap-5">
                                        <div className="flex flex-col gap-2">
                                          <Label htmlFor="new-p assword">
                                            {t("auth.newPassword")}
                                          </Label>
                                          <PasswordInput
                                            id="new-password"
                                            required
                                            className="h-11 text-base focus:ring-2 focus:ring-primary/50 transition-all duration-200"
                                            value={newPassword}
                                            onChange={(e) =>
                                              setNewPassword(e.target.value)
                                            }
                                            disabled={resetLoading}
                                            autoComplete="new-password"
                                          />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                          <Label htmlFor="confirm-password">
                                            {t("auth.confirmNewPassword")}
                                          </Label>
                                          <PasswordInput
                                            id="confirm-password"
                                            required
                                            className="h-11 text-base focus:ring-2 focus:ring-primary/50 transition-all duration-200"
                                            value={confirmPassword}
                                            onChange={(e) =>
                                              setConfirmPassword(e.target.value)
                                            }
                                            disabled={resetLoading}
                                            autoComplete="new-password"
                                          />
                                        </div>
                                        <Button
                                          type="button"
                                          className="w-full h-11 text-base font-semibold"
                                          disabled={
                                            resetLoading ||
                                            !newPassword ||
                                            !confirmPassword
                                          }
                                          onClick={handleCompletePasswordReset}
                                        >
                                          {resetLoading
                                            ? Spinner
                                            : t("auth.resetPasswordButton")}
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          className="w-full h-11 text-base font-semibold"
                                          disabled={resetLoading}
                                          onClick={() => {
                                            setResetStep("verify");
                                            setNewPassword("");
                                            setConfirmPassword("");
                                          }}
                                        >
                                          {t("common.back")}
                                        </Button>
                                      </div>
                                    </>
                                  )}
                              </>
                            )}
                          </div>
                        ) : (
                          <form
                            className="flex flex-col gap-5"
                            onSubmit={handleSubmit}
                          >
                            <div className="flex flex-col gap-2">
                              <Label htmlFor="username">
                                {t("common.username")}
                              </Label>
                              <Input
                                id="username"
                                type="text"
                                required
                                className="h-11 text-base"
                                value={localUsername}
                                onChange={(e) =>
                                  setLocalUsername(e.target.value)
                                }
                                disabled={loading || loggedIn}
                              />
                            </div>
                            <div className="flex flex-col gap-2">
                              <Label htmlFor="password">
                                {t("common.password")}
                              </Label>
                              <PasswordInput
                                id="password"
                                required
                                className="h-11 text-base"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={loading || loggedIn}
                              />
                            </div>
                            {tab === "signup" && (
                              <div className="flex flex-col gap-2">
                                <Label htmlFor="signup-confirm-password">
                                  {t("common.confirmPassword")}
                                </Label>
                                <PasswordInput
                                  id="signup-confirm-password"
                                  required
                                  className="h-11 text-base"
                                  value={signupConfirmPassword}
                                  onChange={(e) =>
                                    setSignupConfirmPassword(e.target.value)
                                  }
                                  disabled={loading || loggedIn}
                                />
                              </div>
                            )}
                            <Button
                              type="submit"
                              className="w-full h-11 mt-2 text-base font-semibold"
                              disabled={loading || internalLoggedIn}
                            >
                              {loading
                                ? Spinner
                                : tab === "login"
                                  ? t("common.login")
                                  : t("auth.signUp")}
                            </Button>
                            {tab === "login" && (
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full h-11 text-base font-semibold"
                                disabled={loading || loggedIn}
                                onClick={() => {
                                  setTab("reset");
                                  resetPasswordState();
                                  clearFormFields();
                                }}
                              >
                                {t("auth.resetPasswordButton")}
                              </Button>
                            )}
                          </form>
                        )}

                        <div className="mt-6 pt-4 border-t border-edge space-y-4">
                          <div className="flex items-center justify-between">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                const isDark =
                                  theme === "dark" ||
                                  (theme === "system" &&
                                    window.matchMedia(
                                      "(prefers-color-scheme: dark)",
                                    ).matches);
                                setTheme(isDark ? "light" : "dark");
                              }}
                            >
                              {theme === "dark" ||
                              (theme === "system" &&
                                window.matchMedia(
                                  "(prefers-color-scheme: dark)",
                                ).matches) ? (
                                <Moon className="w-4 h-4" />
                              ) : (
                                <Sun className="w-4 h-4" />
                              )}
                            </Button>
                            <LanguageSwitcher />
                          </div>
                          {isElectron() && currentServerUrl && (
                            <div className="flex items-center justify-between">
                              <div>
                                <Label className="text-sm text-muted-foreground">
                                  {t("serverConfig.serverUrl")}
                                </Label>
                                <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                  {currentServerUrl}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowServerConfig(true)}
                                className="h-8 px-3"
                              >
                                {t("common.edit")}
                              </Button>
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
