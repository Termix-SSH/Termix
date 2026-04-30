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
  getGuacamoleSettings,
  updateGuacamoleSettings,
  getLogLevel,
  updateLogLevel,
  getSessionTimeout,
  updateSessionTimeout,
} from "@/ui/main-axios.ts";
import { Button } from "@/components/ui/button.tsx";

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

  const [statusInterval, setStatusInterval] = React.useState(60);
  const [metricsInterval, setMetricsInterval] = React.useState(30);
  const [statusInputValue, setStatusInputValue] = React.useState("60");
  const [metricsInputValue, setMetricsInputValue] = React.useState("30");
  const [statusUnit, setStatusUnit] = React.useState<"seconds" | "minutes">(
    "seconds",
  );
  const [metricsUnit, setMetricsUnit] = React.useState<"seconds" | "minutes">(
    "seconds",
  );
  const [monitoringLoading, setMonitoringLoading] = React.useState(false);

  const [logLevel, setLogLevel] = React.useState("info");
  const [logLevelLoading, setLogLevelLoading] = React.useState(false);

  const [, setSessionTimeoutHours] = React.useState(24);
  const [sessionTimeoutInput, setSessionTimeoutInput] = React.useState("24");
  const [sessionTimeoutLoading, setSessionTimeoutLoading] =
    React.useState(false);

  const [guacEnabled, setGuacEnabled] = React.useState(true);
  const [guacUrl, setGuacUrl] = React.useState("guacd:4822");
  const [guacLoading, setGuacLoading] = React.useState(false);

  React.useEffect(() => {
    getLogLevel()
      .then((data) => {
        setLogLevel(data.level);
      })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    getSessionTimeout()
      .then((data) => {
        setSessionTimeoutHours(data.timeoutHours);
        setSessionTimeoutInput(String(data.timeoutHours));
      })
      .catch(() => {});
  }, []);

  const handleLogLevelChange = async (value: string) => {
    setLogLevel(value);
    setLogLevelLoading(true);
    try {
      await updateLogLevel(value);
      toast.success(t("admin.logLevelSaved"));
    } catch {
      toast.error(t("admin.failedToSaveLogLevel"));
    } finally {
      setLogLevelLoading(false);
    }
  };

  const handleSessionTimeoutBlur = async () => {
    const num = parseInt(sessionTimeoutInput) || 24;
    const clamped = Math.max(1, Math.min(720, num));
    setSessionTimeoutHours(clamped);
    setSessionTimeoutInput(String(clamped));
    setSessionTimeoutLoading(true);
    try {
      await updateSessionTimeout(clamped);
      toast.success(t("admin.sessionTimeoutSaved"));
    } catch {
      toast.error(t("admin.failedToSaveSessionTimeout"));
    } finally {
      setSessionTimeoutLoading(false);
    }
  };

  React.useEffect(() => {
    getGuacamoleSettings()
      .then((data) => {
        setGuacEnabled(data.enabled);
        setGuacUrl(data.url);
      })
      .catch(() => {
        toast.error(t("admin.failedToLoadGuacamoleSettings"));
      });
  }, [t]);

  const saveGuacDebounce = React.useRef<NodeJS.Timeout | null>(null);

  const saveGuacSettings = React.useCallback(
    (newEnabled: boolean, newUrl: string) => {
      if (saveGuacDebounce.current) {
        clearTimeout(saveGuacDebounce.current);
      }
      saveGuacDebounce.current = setTimeout(async () => {
        setGuacLoading(true);
        try {
          await updateGuacamoleSettings({ enabled: newEnabled, url: newUrl });
          toast.success(t("admin.guacamoleSettingsSaved"));
        } catch {
          toast.error(t("admin.failedToSaveGuacamoleSettings"));
        } finally {
          setGuacLoading(false);
        }
      }, 800);
    },
    [t],
  );

  React.useEffect(() => {
    getGlobalMonitoringSettings()
      .then((data) => {
        setStatusInterval(data.statusCheckInterval);
        setMetricsInterval(data.metricsInterval);
        setStatusInputValue(String(data.statusCheckInterval));
        setMetricsInputValue(String(data.metricsInterval));
      })
      .catch(() => {
        // Use defaults silently
      });
  }, []);

  const saveMonitoringSettings = React.useCallback(
    async (newStatus: number, newMetrics: number) => {
      setMonitoringLoading(true);
      try {
        await updateGlobalMonitoringSettings({
          statusCheckInterval: newStatus,
          metricsInterval: newMetrics,
        });
        toast.success(t("admin.globalSettingsSaved"));
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : t("admin.failedToSaveGlobalSettings");
        toast.error(errorMessage);
      } finally {
        setMonitoringLoading(false);
      }
    },
    [t],
  );

  const handleStatusBlur = () => {
    const num = parseInt(statusInputValue) || 0;
    const seconds = statusUnit === "minutes" ? num * 60 : num;
    const clamped = Math.max(5, Math.min(3600, seconds));
    setStatusInterval(clamped);
    setStatusInputValue(
      statusUnit === "minutes"
        ? String(Math.round(clamped / 60))
        : String(clamped),
    );
    saveMonitoringSettings(clamped, metricsInterval);
  };

  const handleMetricsBlur = () => {
    const num = parseInt(metricsInputValue) || 0;
    const seconds = metricsUnit === "minutes" ? num * 60 : num;
    const clamped = Math.max(5, Math.min(3600, seconds));
    setMetricsInterval(clamped);
    setMetricsInputValue(
      metricsUnit === "minutes"
        ? String(Math.round(clamped / 60))
        : String(clamped),
    );
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
        <h3 className="text-lg font-semibold">{t("admin.sessionTimeout")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("admin.sessionTimeoutDesc")}
        </p>
        <div>
          <label className="text-sm font-medium">
            {t("admin.sessionTimeoutHours")}
          </label>
          <div className="flex gap-2 mt-1">
            <Input
              type="number"
              min={1}
              max={720}
              value={sessionTimeoutInput}
              onChange={(e) => setSessionTimeoutInput(e.target.value)}
              onBlur={handleSessionTimeoutBlur}
              disabled={sessionTimeoutLoading}
              className="flex-1"
            />
            <span className="text-sm font-medium py-2">{t("admin.hours")}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("admin.sessionTimeoutNote")}
          </p>
        </div>
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
                value={statusInputValue}
                onChange={(e) => setStatusInputValue(e.target.value)}
                onBlur={handleStatusBlur}
                disabled={monitoringLoading}
                className="flex-1"
              />
              <Select
                value={statusUnit}
                onValueChange={(value: "seconds" | "minutes") => {
                  setStatusUnit(value);
                  setStatusInputValue(
                    value === "minutes"
                      ? String(Math.round(statusInterval / 60))
                      : String(statusInterval),
                  );
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
                value={metricsInputValue}
                onChange={(e) => setMetricsInputValue(e.target.value)}
                onBlur={handleMetricsBlur}
                disabled={monitoringLoading}
                className="flex-1"
              />
              <Select
                value={metricsUnit}
                onValueChange={(value: "seconds" | "minutes") => {
                  setMetricsUnit(value);
                  setMetricsInputValue(
                    value === "minutes"
                      ? String(Math.round(metricsInterval / 60))
                      : String(metricsInterval),
                  );
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

      <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
        <h3 className="text-lg font-semibold">
          {t("admin.guacamoleIntegration")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("admin.guacamoleIntegrationDesc")}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={() =>
            window.open("https://docs.termix.site/remote-desktop", "_blank")
          }
        >
          {t("common.documentation")}
        </Button>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={guacEnabled}
            onCheckedChange={(checked) => {
              const val = checked === true;
              setGuacEnabled(val);
              saveGuacSettings(val, guacUrl);
            }}
            disabled={guacLoading}
          />
          {t("admin.enableGuacamole")}
        </label>
        {guacEnabled && (
          <div>
            <label className="text-sm font-medium">{t("admin.guacdUrl")}</label>
            <Input
              className="mt-1"
              value={guacUrl}
              placeholder={t("admin.guacdUrlPlaceholder")}
              disabled={guacLoading}
              onChange={(e) => {
                setGuacUrl(e.target.value);
                saveGuacSettings(guacEnabled, e.target.value);
              }}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("admin.guacdUrlNote")}
            </p>
          </div>
        )}
      </div>

      <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
        <h3 className="text-lg font-semibold">{t("admin.logLevel")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("admin.logLevelDesc")}
        </p>
        <div>
          <label className="text-sm font-medium">
            {t("admin.logVerbosity")}
          </label>
          <Select
            value={logLevel}
            onValueChange={handleLogLevelChange}
            disabled={logLevelLoading}
          >
            <SelectTrigger className="w-[200px] mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            {t("admin.logLevelNote")}
          </p>
        </div>
      </div>
    </div>
  );
}
