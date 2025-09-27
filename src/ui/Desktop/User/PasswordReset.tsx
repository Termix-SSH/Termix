import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Key } from "lucide-react";
import React, { useState } from "react";
import {
  completePasswordReset,
  initiatePasswordReset,
  verifyPasswordResetCode,
} from "@/ui/main-axios.ts";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface PasswordResetProps {
  userInfo: {
    username: string;
    is_admin: boolean;
    is_oidc: boolean;
    totp_enabled: boolean;
  };
}

export function PasswordReset({ userInfo }: PasswordResetProps) {
  const [error, setError] = useState<string | null>(null);

  const [resetStep, setResetStep] = useState<
    "initiate" | "verify" | "newPassword"
  >("initiate");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const { t } = useTranslation();

  async function handleInitiatePasswordReset() {
    setError(null);
    setResetLoading(true);
    try {
      const result = await initiatePasswordReset(userInfo.username);
      setResetStep("verify");
      setError(null);
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
          err?.message ||
          t("common.failedToInitiatePasswordReset"),
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
  }

  async function handleVerifyResetCode() {
    setError(null);
    setResetLoading(true);
    try {
      const response = await verifyPasswordResetCode(
        userInfo.username,
        resetCode,
      );
      setTempToken(response.tempToken);
      setResetStep("newPassword");
      setError(null);
    } catch (err: any) {
      setError(
        err?.response?.data?.error || t("common.failedToVerifyResetCode"),
      );
    } finally {
      setResetLoading(false);
    }
  }

  async function handleCompletePasswordReset() {
    setError(null);
    setResetLoading(true);

    if (newPassword !== confirmPassword) {
      setError(t("common.passwordsDoNotMatch"));
      setResetLoading(false);
      return;
    }

    if (newPassword.length < 6) {
      setError(t("common.passwordMinLength"));
      setResetLoading(false);
      return;
    }

    try {
      await completePasswordReset(userInfo.username, tempToken, newPassword);

      toast.success(t("common.passwordResetSuccess"));
      resetPasswordState();
    } catch (err: any) {
      setError(
        err?.response?.data?.error || t("common.failedToCompletePasswordReset"),
      );
    } finally {
      setResetLoading(false);
    }
  }

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="w-5 h-5" />
          {t("common.password")}
        </CardTitle>
        <CardDescription>{t("common.changeAccountPassword")}</CardDescription>
      </CardHeader>
      <CardContent>
        <>
          {resetStep === "initiate" && (
            <>
              <div className="flex flex-col gap-4">
                <Button
                  type="button"
                  className="w-full h-11 text-base"
                  disabled={resetLoading || !userInfo.username.trim()}
                  onClick={handleInitiatePasswordReset}
                >
                  {resetLoading ? Spinner : t("common.sendResetCode")}
                </Button>
              </div>
            </>
          )}

          {resetStep === "verify" && (
            <>
              <div className="text-center text-muted-foreground mb-4">
                <p>
                  {t("common.enterSixDigitCode")}{" "}
                  <strong>{userInfo.username}</strong>
                </p>
              </div>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="reset-code">{t("common.resetCode")}</Label>
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
                    placeholder={t("placeholders.enterCode")}
                  />
                </div>
                <Button
                  type="button"
                  className="w-full h-11 text-base font-semibold"
                  disabled={resetLoading || resetCode.length !== 6}
                  onClick={handleVerifyResetCode}
                >
                  {resetLoading ? Spinner : t("common.verifyCode")}
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
                  Back
                </Button>
              </div>
            </>
          )}

          {resetStep === "newPassword" && (
            <>
              <div className="text-center text-muted-foreground mb-4">
                <p>
                  {t("common.enterNewPassword")}{" "}
                  <strong>{userInfo.username}</strong>
                </p>
              </div>
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="new-password">
                    {t("common.newPassword")}
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
                    {t("common.confirmPassword")}
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
                  disabled={resetLoading || !newPassword || !confirmPassword}
                  onClick={handleCompletePasswordReset}
                >
                  {resetLoading ? Spinner : t("common.resetPassword")}
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
                  Back
                </Button>
              </div>
            </>
          )}
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </>
      </CardContent>
    </Card>
  );
}
