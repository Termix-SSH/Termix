import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Key } from "lucide-react";
import React, { useState } from "react";
import { changePassword } from "@/ui/main-axios.ts";
import { Label } from "@/components/ui/label.tsx";
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  async function handleChangePassword() {
    setError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t("errors.requiredField"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("common.passwordsDoNotMatch"));
      return;
    }

    if (newPassword.length < 6) {
      setError(t("common.passwordMinLength"));
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success(t("profile.passwordChangedSuccess"));
      window.location.reload();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(
        error?.response?.data?.error || t("profile.failedToChangePassword"),
      );
    } finally {
      setLoading(false);
    }
  }

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
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="current-password">
              {t("profile.currentPassword")}
            </Label>
            <PasswordInput
              id="current-password"
              required
              className="h-11 text-base"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">{t("common.newPassword")}</Label>
            <PasswordInput
              id="new-password"
              required
              className="h-11 text-base"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={loading}
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
              className="h-11 text-base"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>
          <Button
            type="button"
            className="w-full h-11 text-base font-semibold mt-2"
            disabled={
              loading || !currentPassword || !newPassword || !confirmPassword
            }
            onClick={handleChangePassword}
          >
            {loading ? Spinner : t("profile.changePassword")}
          </Button>
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
