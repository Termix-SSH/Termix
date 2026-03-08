import React from "react";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  updateRegistrationAllowed,
  updatePasswordLoginAllowed,
  updatePasswordResetAllowed,
  getGlobalMonitoringSettings,
  updateGlobalMonitoringSettings,
} from "@/ui/main-axios.ts";

interface GeneralSettingsTabProps {
  allowRegistration: boolean;
  setAllowRegistration: (value: boolean) => void;
  allowPasswordLogin: boolean;
  setAllowPasswordLogin: (value: boolean) => void;
  allowPasswordReset: boolean;
  setAllowPasswordReset: (value: boolean) => void;
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
  allowPasswordReset,
  setAllowPasswordReset,
  oidcConfig,
}: GeneralSettingsTabProps): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const [regLoading, setRegLoading] = React.useState(false);
  const [passwordLoginLoading, setPasswordLoginLoading] = React.useState(false);
  const [passwordResetLoading, setPasswordResetLoading] = React.useState(false);

  // Global monitoring defaults
  const [statusInterval, setStatusInterval] = React.useState(60);
  const [metricsInterval, setMetricsInterval] = React.useState(30);
  const [statusUnit, setStatusUnit] = React.useState<"seconds" | "minutes">(
    "seconds",
  );
  const [metricsUnit, setMetricsUnit] = React.useState<"seconds" | "minutes">(
    "seconds",
  );
  const [monitoringLoading, setMonitoringLoading] = React.useState(false);

  React.useEffect(() => {
    getGlobalMonitoringSettings()
      .then((data) => {
        setStatusInterval(data.statusCheckInterval);
        setMetricsInterval(data.metricsInterval);
      })
      .catch(() => {
        // Use defaults silently
      });
  }, []);

  const saveMonitoringDebounce = React.useRef<NodeJS.Timeout | null>(null);

  const saveMonitoringSettings = React.useCallback(
    (newStatus: number, newMetrics: number) => {
      if (saveMonitoringDebounce.current) {
        clearTimeout(saveMonitoringDebounce.current);
      }
      saveMonitoringDebounce.current = setTimeout(async () => {
        setMonitoringLoading(true);
        try {
          await updateGlobalMonitoringSettings({
            statusCheckInterval: newStatus,
            metricsInterval: newMetrics,
          });
          toast.success(t("admin.globalSettingsSaved"));
        } catch {
          toast.error(t("admin.failedToSaveGlobalSettings"));
        } finally {
          setMonitoringLoading(false);
        }
      }, 800);
    },
    [t],
  );

  const handleStatusIntervalChange = (value: string) => {
    const num = parseInt(value) || 0;
    const seconds = statusUnit === "minutes" ? num * 60 : num;
    const clamped = Math.max(5, Math.min(3600, seconds));
    setStatusInterval(clamped);
    saveMonitoringSettings(clamped, metricsInterval);
  };

  const handleMetricsIntervalChange = (value: string) => {
    const num = parseInt(value) || 0;
    const seconds = metricsUnit === "minutes" ? num * 60 : num;
    const clamped = Math.max(5, Math.min(3600, seconds));
    setMetricsInterval(clamped);
    saveMonitoringSettings(statusInterval, clamped);
  };

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

  const handleTogglePasswordReset = async (checked: boolean) => {
    setPasswordResetLoading(true);
    try {
      await updatePasswordResetAllowed(checked);
      setAllowPasswordReset(checked);
    } finally {
      setPasswordResetLoading(false);
    }
  };

  return (
    <div className="space-y-6">
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
        <label className="flex items-center gap-2">
          <Checkbox
            checked={allowPasswordReset}
            onCheckedChange={handleTogglePasswordReset}
            disabled={passwordResetLoading || !allowPasswordLogin}
          />
          {t("admin.allowPasswordReset")}
          {!allowPasswordLogin && (
            <span className="text-xs text-muted-foreground">
              ({t("admin.requiresPasswordLogin")})
            </span>
          )}
        </label>
      </div>

      <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
        <h3 className="text-lg font-semibold">
          {t("admin.monitoringDefaults")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("admin.monitoringDefaultsDesc")}
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">
              {t("admin.globalStatusCheckInterval")}
            </label>
            <div className="flex gap-2 mt-1">
              <Input
                type="number"
                value={
                  statusUnit === "minutes"
                    ? Math.round(statusInterval / 60)
                    : statusInterval
                }
                onChange={(e) => handleStatusIntervalChange(e.target.value)}
                disabled={monitoringLoading}
                className="flex-1"
              />
              <Select
                value={statusUnit}
                onValueChange={(value: "seconds" | "minutes") => {
                  setStatusUnit(value);
                }}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="seconds">
                    {t("hosts.intervalSeconds")}
                  </SelectItem>
                  <SelectItem value="minutes">
                    {t("hosts.intervalMinutes")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">
              {t("admin.globalMetricsInterval")}
            </label>
            <div className="flex gap-2 mt-1">
              <Input
                type="number"
                value={
                  metricsUnit === "minutes"
                    ? Math.round(metricsInterval / 60)
                    : metricsInterval
                }
                onChange={(e) => handleMetricsIntervalChange(e.target.value)}
                disabled={monitoringLoading}
                className="flex-1"
              />
              <Select
                value={metricsUnit}
                onValueChange={(value: "seconds" | "minutes") => {
                  setMetricsUnit(value);
                }}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="seconds">
                    {t("hosts.intervalSeconds")}
                  </SelectItem>
                  <SelectItem value="minutes">
                    {t("hosts.intervalMinutes")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
