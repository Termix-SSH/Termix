import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert.tsx";
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
  initiatePasswordReset,
  verifyPasswordResetCode,
  completePasswordReset,
  getOIDCAuthorizeUrl,
  verifyTOTPLogin,
  setCookie,
  getCookie,
  logoutUser,
  isElectron,
} from "@/ui/main-axios.ts";
import { PasswordInput } from "@/components/ui/password-input.tsx";

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
  const [error, setError] = useState<string | null>(null);
  const [internalLoggedIn, setInternalLoggedIn] = useState(false);
  const [firstUser, setFirstUser] = useState(false);
  const [firstUserToastShown, setFirstUserToastShown] = useState(false);
  const [registrationAllowed, setRegistrationAllowed] = useState(true);
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

  useEffect(() => {
    setInternalLoggedIn(loggedIn);
  }, [loggedIn]);

  useEffect(() => {
    const clearJWTOnLoad = async () => {
      try {
        await logoutUser();
      } catch (error) {
        console.log("JWT cleanup on HomepageAuth load:", error);
      }
    };

    clearJWTOnLoad();
  }, []);

  useEffect(() => {
    getRegistrationAllowed().then((res) => {
      setRegistrationAllowed(res.allowed);
    });
  }, []);

  useEffect(() => {
    if (!registrationAllowed && !internalLoggedIn) {
      toast.warning(t("messages.registrationDisabled"));
    }
  }, [registrationAllowed, internalLoggedIn, t]);

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
      })
      .catch(() => {
        setDbError(t("errors.databaseConnection"));
      });
  }, [setDbError, firstUserToastShown]);

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

      if (!res || !res.success) {
        throw new Error(t("errors.loginFailed"));
      }

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
      const errorMessage =
        err?.response?.data?.error || err?.message || t("errors.unknownError");
      toast.error(errorMessage);
      setInternalLoggedIn(false);
      setLoggedIn(false);
      setIsAdmin(false);
      setUsername(null);
      setUserId(null);
      if (err?.response?.data?.error?.includes("Database")) {
        setDbError(t("errors.databaseConnection"));
      } else {
        setDbError(null);
      }
    } finally {
      setLoading(false);
    }
  }

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

      setTab("login");
      resetPasswordState();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error || t("errors.failedCompleteReset"),
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

      if (!res || !res.success) {
        throw new Error(t("errors.loginFailed"));
      }

      if (isElectron() && res.token) {
        localStorage.setItem("jwt", res.token);
      }

      setInternalLoggedIn(true);
      setLoggedIn(true);
      setIsAdmin(!!res.is_admin);
      setUsername(res.username || null);
      setUserId(res.userId || null);
      setDbError(null);

      setTimeout(() => {
        onAuthSuccess({
          isAdmin: !!res.is_admin,
          username: res.username || null,
          userId: res.userId || null,
        });
      }, 100);

      setInternalLoggedIn(true);
      setTotpRequired(false);
      setTotpCode("");
      setTotpTempToken("");
      toast.success(t("messages.loginSuccess"));
    } catch (err: any) {
      const errorCode = err?.response?.data?.code;
      const errorMessage =
        err?.response?.data?.error ||
        err?.message ||
        t("errors.invalidTotpCode");

      if (errorCode === "SESSION_EXPIRED") {
        setTotpRequired(false);
        setTotpCode("");
        setTotpTempToken("");
        setTab("login");
        toast.error(t("errors.sessionExpired"));
      } else {
        toast.error(errorMessage);
      }
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
      const errorMessage =
        err?.response?.data?.error ||
        err?.message ||
        t("errors.failedOidcLogin");
      toast.error(errorMessage);
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

    if (success) {
      setOidcLoading(true);
      setError(null);

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

  return (
    <div
      className={`w-full max-w-md flex flex-col bg-dark-bg ${className || ""}`}
      {...props}
    >
      {dbError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{dbError}</AlertDescription>
        </Alert>
      )}
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

      {internalLoggedIn && !authLoading && (
        <div className="flex flex-col gap-5">
          <div className="mb-6 text-center">
            <h2 className="text-xl font-bold mb-1">
              {t("homepage.loggedInTitle")}
            </h2>
            <p className="text-muted-foreground">
              {t("mobile.mobileAppInProgressDesc")}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-11 text-base font-semibold"
            onClick={() =>
              window.open("https://docs.termix.site/install", "_blank")
            }
          >
            {t("mobile.viewMobileAppDocs")}
          </Button>
        </div>
      )}

      {!internalLoggedIn && !authLoading && !totpRequired && (
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
                  <Button
                    type="button"
                    className="w-full h-11 mt-2 text-base font-semibold"
                    disabled={oidcLoading}
                    onClick={handleOIDCLogin}
                  >
                    {oidcLoading ? Spinner : t("auth.loginWithExternal")}
                  </Button>
                </>
              )}
              {tab === "reset" && (
                <>
                  {resetStep === "initiate" && (
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
                          {resetLoading ? Spinner : t("auth.verifyCodeButton")}
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
                            onChange={(e) => setConfirmPassword(e.target.value)}
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

          <div className="mt-6 pt-4 border-t border-dark-border">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm text-muted-foreground">
                  {t("common.language")}
                </Label>
              </div>
              <LanguageSwitcher />
            </div>
          </div>

          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 text-base font-semibold"
              onClick={() =>
                window.open("https://docs.termix.site/install", "_blank")
              }
            >
              {t("mobile.viewMobileAppDocs")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
