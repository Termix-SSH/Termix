import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/ui/Desktop/User/LanguageSwitcher.tsx";
import { toast } from "sonner";
import {
  registerUser,
  loginUser,
  getUserInfo,
  getRegistrationAllowed,
  getOIDCConfig,
  getSetupRequired,
  requestRecoveryCode,
  verifyRecoveryCode,
  loginWithRecovery,
  initiatePasswordReset,
  verifyPasswordResetCode,
  completePasswordReset,
  getOIDCAuthorizeUrl,
  verifyTOTPLogin,
  setCookie,
  getCookie,
  getServerConfig,
  isElectron,
} from "../../main-axios.ts";
import { ServerConfig as ServerConfigComponent } from "@/ui/Desktop/Electron Only/ServerConfig.tsx";

interface HomepageAuthProps extends React.ComponentProps<"div"> {
  setLoggedIn: (loggedIn: boolean) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setUsername: (username: string | null) => void;
  setUserId: (userId: string | null) => void;
  loggedIn: boolean;
  authLoading: boolean;
  dbError: string | null;
  setDbError: (error: string | null) => void;
  onAuthSuccess: (authData: {
    isAdmin: boolean;
    username: string | null;
    userId: string | null;
  }) => void;
}

export function HomepageAuth({
  className,
  setLoggedIn,
  setIsAdmin,
  setUsername,
  setUserId,
  loggedIn,
  authLoading,
  dbError,
  setDbError,
  onAuthSuccess,
  ...props
}: HomepageAuthProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"login" | "signup" | "external" | "reset">(
    "login",
  );
  const [localUsername, setLocalUsername] = useState("");
  const [password, setPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oidcLoading, setOidcLoading] = useState(false);
  const [visibility, setVisibility] = useState({
    password: false,
    signupConfirm: false,
    resetNew: false,
    resetConfirm: false,
  });
  const toggleVisibility = (field: keyof typeof visibility) => {
    setVisibility((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const [error, setError] = useState<string | null>(null);
  const [internalLoggedIn, setInternalLoggedIn] = useState(false);
  const [firstUser, setFirstUser] = useState(false);
  const [registrationAllowed, setRegistrationAllowed] = useState(true);
  const [oidcConfigured, setOidcConfigured] = useState(false);

  // Recovery states (new UX compromise flow)
  const [recoveryStep, setRecoveryStep] = useState<
    "request" | "verify" | "login"
  >("request");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryTempToken, setRecoveryTempToken] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoverySuccess, setRecoverySuccess] = useState(false);

  // Legacy reset states (kept for compatibility)
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

  useEffect(() => {
    setInternalLoggedIn(loggedIn);
  }, [loggedIn]);

  useEffect(() => {
    getRegistrationAllowed().then((res) => {
      setRegistrationAllowed(res.allowed);
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
    setDbHealthChecking(true);
    getSetupRequired()
      .then((res) => {
        if (res.setup_required) {
          setFirstUser(true);
          setTab("signup");
          toast.info(t("auth.firstUserMessage"));
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
  }, [setDbError, t]);

  useEffect(() => {
    if (!registrationAllowed && !internalLoggedIn) {
      toast.warning(t("messages.registrationDisabled"));
    }
  }, [registrationAllowed, internalLoggedIn, t]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!localUsername.trim()) {
      toast.error(t("errors.requiredField"));
      setLoading(false);
      return;
    }

    try {
      let res, meRes;
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

      if (!res || !res.token) {
        throw new Error(t("errors.noTokenReceived"));
      }

      setCookie("jwt", res.token);

      // DEBUG: Verify JWT was set correctly
      const verifyJWT = getCookie("jwt");
      console.log("JWT Set Debug:", {
        originalToken: res.token.substring(0, 20) + "...",
        retrievedToken: verifyJWT ? verifyJWT.substring(0, 20) + "..." : null,
        match: res.token === verifyJWT,
        tokenLength: res.token.length,
        retrievedLength: verifyJWT?.length || 0
      });

      [meRes] = await Promise.all([getUserInfo()]);

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
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error || err?.message || t("errors.unknownError"),
      );
      setInternalLoggedIn(false);
      setLoggedIn(false);
      setIsAdmin(false);
      setUsername(null);
      setUserId(null);
      setCookie("jwt", "", -1);
      if (err?.response?.data?.error?.includes("Database")) {
        setDbConnectionFailed(true);
      } else {
        setDbError(null);
      }
    } finally {
      setLoading(false);
    }
  }

  // ===== New Recovery Functions (UX compromise) =====

  async function handleRequestRecoveryCode() {
    setError(null);
    setRecoveryLoading(true);
    try {
      const result = await requestRecoveryCode(localUsername);
      setRecoveryStep("verify");
      toast.success("Recovery code sent to Docker logs");
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error ||
          err?.message ||
          "Failed to request recovery code",
      );
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleVerifyRecoveryCode() {
    setError(null);
    setRecoveryLoading(true);
    try {
      const response = await verifyRecoveryCode(localUsername, recoveryCode);
      setRecoveryTempToken(response.tempToken);
      setRecoveryStep("login");
      toast.success("Recovery verification successful");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to verify recovery code");
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleRecoveryLogin() {
    setError(null);
    setRecoveryLoading(true);
    try {
      const response = await loginWithRecovery(localUsername, recoveryTempToken);

      // Auto-login successful - use same cookie mechanism as normal login
      setCookie("jwt", response.token);

      // DEBUG: Verify JWT was set correctly (same as normal login)
      const verifyJWT = getCookie("jwt");
      console.log("Recovery JWT Set Debug:", {
        originalToken: response.token.substring(0, 20) + "...",
        retrievedToken: verifyJWT ? verifyJWT.substring(0, 20) + "..." : null,
        match: response.token === verifyJWT,
        tokenLength: response.token.length,
        retrievedLength: verifyJWT?.length || 0
      });

      setLoggedIn(true);
      setIsAdmin(response.is_admin);
      setUsername(response.username);

      onAuthSuccess({
        isAdmin: response.is_admin,
        username: response.username,
        userId: response.userId || null,
      });

      // Reset recovery state
      setRecoveryStep("request");
      setRecoveryCode("");
      setRecoveryTempToken("");
      setRecoverySuccess(true);

      toast.success("Login successful via recovery");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Recovery login failed");
    } finally {
      setRecoveryLoading(false);
    }
  }

  function resetRecoveryState() {
    setRecoveryStep("request");
    setRecoveryCode("");
    setRecoveryTempToken("");
    setError(null);
  }

  // ===== Legacy password reset functions (deprecated) =====

  async function handleInitiatePasswordReset() {
    setError(null);
    setResetLoading(true);
    try {
      const result = await initiatePasswordReset(localUsername);
      setResetStep("verify");
      toast.success(t("messages.resetCodeSent"));
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error ||
          err?.message ||
          t("errors.failedPasswordReset"),
      );
    } finally {
      setResetLoading(false);
    }
  }

  async function handleVerifyResetCode() {
    setError(null);
    setResetLoading(true);
    try {
      const response = await verifyPasswordResetCode(localUsername, resetCode);
      setTempToken(response.tempToken);
      setResetStep("newPassword");
      toast.success(t("messages.codeVerified"));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t("errors.failedVerifyCode"));
    } finally {
      setResetLoading(false);
    }
  }

  async function handleCompletePasswordReset() {
    setError(null);
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
      setError(null);

      setResetSuccess(true);
      toast.success(t("messages.passwordResetSuccess"));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t("errors.failedCompleteReset"));
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
    setError(null);
    setResetSuccess(false);
    setSignupConfirmPassword("");
  }

  function clearFormFields() {
    setPassword("");
    setSignupConfirmPassword("");
    setError(null);
  }

  async function handleTOTPVerification() {
    if (totpCode.length !== 6) {
      toast.error(t("auth.enterCode"));
      return;
    }

    setError(null);
    setTotpLoading(true);

    try {
      const res = await verifyTOTPLogin(totpTempToken, totpCode);

      if (!res || !res.token) {
        throw new Error(t("errors.noTokenReceived"));
      }

      setCookie("jwt", res.token);
      const meRes = await getUserInfo();

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
      setTotpRequired(false);
      setTotpCode("");
      setTotpTempToken("");
      toast.success(t("messages.loginSuccess"));
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error ||
          err?.message ||
          t("errors.invalidTotpCode"),
      );
    } finally {
      setTotpLoading(false);
    }
  }

  async function handleOIDCLogin() {
    setError(null);
    setOidcLoading(true);
    try {
      const authResponse = await getOIDCAuthorizeUrl();
      const { auth_url: authUrl } = authResponse;

      if (!authUrl || authUrl === "undefined") {
        throw new Error(t("errors.invalidAuthUrl"));
      }

      window.location.replace(authUrl);
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error ||
          err?.message ||
          t("errors.failedOidcLogin"),
      );
      setOidcLoading(false);
    }
  }

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get("success");
    const token = urlParams.get("token");
    const error = urlParams.get("error");

    if (error) {
      toast.error(`${t("errors.oidcAuthFailed")}: ${error}`);
      setOidcLoading(false);
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (success && token) {
      setOidcLoading(true);
      setError(null);

      setCookie("jwt", token);
      getUserInfo()
        .then((meRes) => {
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
        .catch((err) => {
          toast.error(t("errors.failedUserInfo"));
          setInternalLoggedIn(false);
          setLoggedIn(false);
          setIsAdmin(false);
          setUsername(null);
          setUserId(null);
          setCookie("jwt", "", -1);
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
  }, []);

  const Spinner = (
    <svg
      className="animate-spin mr-2 h-4 w-4 text-white inline-block"
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

  const [showServerConfig, setShowServerConfig] = useState<boolean | null>(
    null,
  );
  const [currentServerUrl, setCurrentServerUrl] = useState<string>("");
  const [dbConnectionFailed, setDbConnectionFailed] = useState(false);
  const [dbHealthChecking, setDbHealthChecking] = useState(false);

  useEffect(() => {
    if (dbConnectionFailed) {
      toast.error(t("errors.databaseConnection"));
    }
  }, [dbConnectionFailed, t]);

  const retryDatabaseConnection = async () => {
    setDbHealthChecking(true);
    setDbConnectionFailed(false);
    try {
      const res = await getSetupRequired();
      if (res.setup_required) {
        setFirstUser(true);
        setTab("signup");
      } else {
        setFirstUser(false);
      }
      setDbError(null);
      toast.success(t("messages.databaseConnected"));
    } catch (error) {
      setDbConnectionFailed(true);
    } finally {
      setDbHealthChecking(false);
    }
  };

  useEffect(() => {
    const checkServerConfig = async () => {
      if (isElectron()) {
        try {
          const config = await getServerConfig();
          setCurrentServerUrl(config?.serverUrl || "");
          setShowServerConfig(!config || !config.serverUrl);
        } catch (error) {
          setShowServerConfig(true);
        }
      } else {
        setShowServerConfig(false);
      }
    };

    checkServerConfig();
  }, []);

  if (showServerConfig === null) {
    return (
      <div
        className={`w-[420px] max-w-full p-6 flex flex-col bg-dark-bg border-2 border-dark-border rounded-md ${className || ""}`}
        {...props}
      >
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (showServerConfig) {
    return (
      <div
        className={`w-[420px] max-w-full p-6 flex flex-col bg-dark-bg border-2 border-dark-border rounded-md ${className || ""}`}
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

  if (dbHealthChecking && !dbConnectionFailed) {
    return (
      <div
        className={`w-[420px] max-w-full p-6 flex flex-col bg-dark-bg border-2 border-dark-border rounded-md ${className || ""}`}
        {...props}
      >
        <div className="flex items-center justify-center h-32">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">
              {t("common.checkingDatabase")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (dbConnectionFailed) {
    return (
      <div
        className={`w-[420px] max-w-full p-6 flex flex-col bg-dark-bg border-2 border-dark-border rounded-md ${className || ""}`}
        {...props}
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

        <div className="mt-6 pt-4 border-t border-dark-border space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-muted-foreground">
                {t("common.language")}
              </Label>
            </div>
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
    );
  }

  return (
    <div
      className={`w-[420px] max-w-full p-6 flex flex-col bg-dark-bg border-2 border-dark-border rounded-md ${className || ""}`}
      {...props}
    >
      {totpRequired && (
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
              id="totp-code"
              type="text"
              placeholder="000000"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
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
              setError(null);
            }}
          >
            {t("common.cancel")}
          </Button>
        </div>
      )}

      {!internalLoggedIn &&
        (!authLoading || !getCookie("jwt")) &&
        !totpRequired && (
          <>
            <div className="flex gap-2 mb-6">
              <button
                type="button"
                className={cn(
                  "flex-1 py-2 text-base font-medium rounded-md transition-all",
                  tab === "login"
                    ? "bg-primary text-primary-foreground shadow"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
                onClick={() => {
                  setTab("login");
                  if (tab === "reset") resetPasswordState();
                  if (tab === "signup") clearFormFields();
                }}
                aria-selected={tab === "login"}
                disabled={loading || firstUser}
              >
                {t("common.login")}
              </button>
              <button
                type="button"
                className={cn(
                  "flex-1 py-2 text-base font-medium rounded-md transition-all",
                  tab === "signup"
                    ? "bg-primary text-primary-foreground shadow"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
                onClick={() => {
                  setTab("signup");
                  if (tab === "reset") resetPasswordState();
                  if (tab === "login") clearFormFields();
                }}
                aria-selected={tab === "signup"}
                disabled={loading || !registrationAllowed}
              >
                {t("common.register")}
              </button>
              {oidcConfigured && (
                <button
                  type="button"
                  className={cn(
                    "flex-1 py-2 text-base font-medium rounded-md transition-all",
                    tab === "external"
                      ? "bg-primary text-primary-foreground shadow"
                      : "bg-muted text-muted-foreground hover:bg-accent",
                  )}
                  onClick={() => {
                    setTab("external");
                    if (tab === "reset") resetPasswordState();
                    if (tab === "login" || tab === "signup") clearFormFields();
                  }}
                  aria-selected={tab === "external"}
                  disabled={oidcLoading}
                >
                  {t("auth.external")}
                </button>
              )}
            </div>
            <div className="mb-6 text-center">
              <h2 className="text-xl font-bold mb-1">
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
                              {t("auth.externalNotSupportedInElectron")}
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
                    {/* New Recovery Flow (UX compromise) */}
                    {recoveryStep === "request" && (
                      <>
                        <div className="text-center text-muted-foreground mb-4">
                          <p>🔥 Password Recovery with Docker Access</p>
                          <p className="text-sm mt-2">
                            Recovery requires server access to view Docker logs
                          </p>
                        </div>
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="recovery-username">
                              {t("common.username")}
                            </Label>
                            <Input
                              id="recovery-username"
                              type="text"
                              required
                              className="h-11 text-base"
                              value={localUsername}
                              onChange={(e) => setLocalUsername(e.target.value)}
                              disabled={recoveryLoading}
                            />
                          </div>
                          <Button
                            type="button"
                            className="w-full h-11 text-base font-semibold"
                            disabled={recoveryLoading || !localUsername.trim()}
                            onClick={handleRequestRecoveryCode}
                          >
                            {recoveryLoading ? Spinner : "Request Recovery Code"}
                          </Button>
                        </div>
                      </>
                    )}

                    {recoveryStep === "verify" && (
                      <>
                        <div className="text-center text-muted-foreground mb-4">
                          <p>
                            Check Docker logs for recovery code for{" "}
                            <strong>{localUsername}</strong>
                          </p>
                          <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                            docker logs termix | grep RECOVERY
                          </div>
                        </div>
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="recovery-code">
                              Recovery Code (6 digits)
                            </Label>
                            <Input
                              id="recovery-code"
                              type="text"
                              required
                              maxLength={6}
                              className="h-11 text-base text-center text-lg tracking-widest"
                              value={recoveryCode}
                              onChange={(e) =>
                                setRecoveryCode(e.target.value.replace(/\D/g, ""))
                              }
                              disabled={recoveryLoading}
                              placeholder="000000"
                            />
                          </div>
                          <Button
                            type="button"
                            className="w-full h-11 text-base font-semibold"
                            disabled={recoveryLoading || recoveryCode.length !== 6}
                            onClick={handleVerifyRecoveryCode}
                          >
                            {recoveryLoading ? Spinner : "Verify & Unlock"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full h-11 text-base font-semibold"
                            disabled={recoveryLoading}
                            onClick={() => {
                              setRecoveryStep("request");
                              setRecoveryCode("");
                            }}
                          >
                            Back
                          </Button>
                        </div>
                      </>
                    )}

                    {recoveryStep === "login" && (
                      <>
                        <div className="text-center text-muted-foreground mb-4">
                          <p>✅ Recovery verification successful!</p>
                          <p className="text-sm mt-2">
                            Click below to complete login for{" "}
                            <strong>{localUsername}</strong>
                          </p>
                        </div>
                        <div className="flex flex-col gap-4">
                          <Button
                            type="button"
                            className="w-full h-11 text-base font-semibold"
                            disabled={recoveryLoading}
                            onClick={handleRecoveryLogin}
                          >
                            {recoveryLoading ? Spinner : "Complete Login"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full h-11 text-base font-semibold"
                            disabled={recoveryLoading}
                            onClick={() => {
                              resetRecoveryState();
                            }}
                          >
                            Start Over
                          </Button>
                        </div>
                      </>
                    )}

                    {/* Legacy Reset Flow (kept for compatibility) */}
                    {false && resetStep === "initiate" && (
                      <>
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
                              onChange={(e) => setLocalUsername(e.target.value)}
                              disabled={resetLoading}
                            />
                          </div>
                          <Button
                            type="button"
                            className="w-full h-11 text-base font-semibold"
                            disabled={resetLoading || !localUsername.trim()}
                            onClick={handleInitiatePasswordReset}
                          >
                            {resetLoading ? Spinner : t("auth.sendResetCode")}
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
                                setResetCode(e.target.value.replace(/\D/g, ""))
                              }
                              disabled={resetLoading}
                              placeholder="000000"
                            />
                          </div>
                          <Button
                            type="button"
                            className="w-full h-11 text-base font-semibold"
                            disabled={resetLoading || resetCode.length !== 6}
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

                    {resetSuccess && (
                      <>
                        <div className="text-center p-4 bg-green-500/10 rounded-lg border border-green-500/20 mb-4">
                          <p className="text-green-400 text-sm">
                            {t("auth.passwordResetSuccessDesc")}
                          </p>
                        </div>
                        <Button
                          type="button"
                          className="w-full h-11 text-base font-semibold"
                          onClick={() => {
                            setTab("login");
                            resetPasswordState();
                          }}
                        >
                          {t("auth.goToLogin")}
                        </Button>
                      </>
                    )}

                    {resetStep === "newPassword" && !resetSuccess && (
                      <>
                        <div className="text-center text-muted-foreground mb-4">
                          <p>
                            {t("auth.enterNewPassword")}{" "}
                            <strong>{localUsername}</strong>
                          </p>
                        </div>
                        <div className="flex flex-col gap-5">
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="new-password">
                              {t("auth.newPassword")}
                            </Label>
                            <PasswordInput
                              id="new-password"
                              required
                              className="h-11 text-base focus:ring-2 focus:ring-primary/50 transition-all duration-200"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
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
                              resetLoading || !newPassword || !confirmPassword
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
              <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="username">{t("common.username")}</Label>
                  <Input
                    id="username"
                    type="text"
                    required
                    className="h-11 text-base"
                    value={localUsername}
                    onChange={(e) => setLocalUsername(e.target.value)}
                    disabled={loading || internalLoggedIn}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password">{t("common.password")}</Label>
                  <PasswordInput
                    id="password"
                    required
                    className="h-11 text-base"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading || internalLoggedIn}
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
                      onChange={(e) => setSignupConfirmPassword(e.target.value)}
                      disabled={loading || internalLoggedIn}
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
                    disabled={loading || internalLoggedIn}
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

            <div className="mt-6 pt-4 border-t border-dark-border space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm text-muted-foreground">
                    {t("common.language")}
                  </Label>
                </div>
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
          </>
        )}
    </div>
  );
}
