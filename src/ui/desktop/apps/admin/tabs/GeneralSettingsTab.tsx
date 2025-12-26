import React from "react";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  updateRegistrationAllowed,
  updatePasswordLoginAllowed,
} from "@/ui/main-axios.ts";

interface GeneralSettingsTabProps {
  allowRegistration: boolean;
  setAllowRegistration: (value: boolean) => void;
  allowPasswordLogin: boolean;
  setAllowPasswordLogin: (value: boolean) => void;
  oidcConfig: {
    client_id: string;
    client_secret: string;
    issuer_url: string;
    authorization_url: string;
    token_url: string;
  };
}

export function GeneralSettingsTab({
  allowRegistration,
  setAllowRegistration,
  allowPasswordLogin,
  setAllowPasswordLogin,
  oidcConfig,
}: GeneralSettingsTabProps): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const [regLoading, setRegLoading] = React.useState(false);
  const [passwordLoginLoading, setPasswordLoginLoading] = React.useState(false);

  const handleToggleRegistration = async (checked: boolean) => {
    setRegLoading(true);
    try {
      await updateRegistrationAllowed(checked);
      setAllowRegistration(checked);
    } finally {
      setRegLoading(false);
    }
  };

  const handleTogglePasswordLogin = async (checked: boolean) => {
    if (!checked) {
      const hasOIDCConfigured =
        oidcConfig.client_id &&
        oidcConfig.client_secret &&
        oidcConfig.issuer_url &&
        oidcConfig.authorization_url &&
        oidcConfig.token_url;

      if (!hasOIDCConfigured) {
        toast.error(t("admin.cannotDisablePasswordLoginWithoutOIDC"), {
          duration: 5000,
        });
        return;
      }

      confirmWithToast(
        t("admin.confirmDisablePasswordLogin"),
        async () => {
          setPasswordLoginLoading(true);
          try {
            await updatePasswordLoginAllowed(checked);
            setAllowPasswordLogin(checked);

            if (allowRegistration) {
              await updateRegistrationAllowed(false);
              setAllowRegistration(false);
              toast.success(t("admin.passwordLoginAndRegistrationDisabled"));
            } else {
              toast.success(t("admin.passwordLoginDisabled"));
            }
          } catch {
            toast.error(t("admin.failedToUpdatePasswordLoginStatus"));
          } finally {
            setPasswordLoginLoading(false);
          }
        },
        "destructive",
      );
      return;
    }

    setPasswordLoginLoading(true);
    try {
      await updatePasswordLoginAllowed(checked);
      setAllowPasswordLogin(checked);
    } finally {
      setPasswordLoginLoading(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
      <h3 className="text-lg font-semibold">{t("admin.userRegistration")}</h3>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={allowRegistration}
          onCheckedChange={handleToggleRegistration}
          disabled={regLoading || !allowPasswordLogin}
        />
        {t("admin.allowNewAccountRegistration")}
        {!allowPasswordLogin && (
          <span className="text-xs text-muted-foreground">
            ({t("admin.requiresPasswordLogin")})
          </span>
        )}
      </label>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={allowPasswordLogin}
          onCheckedChange={handleTogglePasswordLogin}
          disabled={passwordLoginLoading}
        />
        {t("admin.allowPasswordLogin")}
      </label>
    </div>
  );
}
