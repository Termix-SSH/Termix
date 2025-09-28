import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert.tsx";
import { VersionAlert } from "@/components/ui/version-alert.tsx";
import { useTranslation } from "react-i18next";
import {
  getServerConfig,
  saveServerConfig,
  testServerConnection,
  checkElectronUpdate,
  type ServerConfig,
} from "@/ui/main-axios.ts";
import { CheckCircle, XCircle, Server, Wifi, RefreshCw } from "lucide-react";

interface ServerConfigProps {
  onServerConfigured: (serverUrl: string) => void;
  onCancel?: () => void;
  isFirstTime?: boolean;
}

export function ServerConfig({
  onServerConfigured,
  onCancel,
  isFirstTime = false,
}: ServerConfigProps) {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "unknown" | "success" | "error"
  >("unknown");
  const [versionInfo, setVersionInfo] = useState<any>(null);
  const [versionChecking, setVersionChecking] = useState(false);
  const [versionDismissed, setVersionDismissed] = useState(false);

  useEffect(() => {
    loadServerConfig();
    checkForUpdates();
  }, []);

  const loadServerConfig = async () => {
    try {
      const config = await getServerConfig();
      if (config?.serverUrl) {
        setServerUrl(config.serverUrl);
        setConnectionStatus("success");
      }
    } catch (error) {}
  };

  const checkForUpdates = async () => {
    setVersionChecking(true);
    try {
      const updateInfo = await checkElectronUpdate();
      setVersionInfo(updateInfo);
    } catch (error) {
      console.error("Failed to check for updates:", error);
      setVersionInfo({ success: false, error: "Check failed" });
    } finally {
      setVersionChecking(false);
    }
  };

  const handleVersionDismiss = () => {
    setVersionDismissed(true);
  };

  const handleDownloadUpdate = () => {
    if (versionInfo?.latest_release?.html_url) {
      window.open(versionInfo.latest_release.html_url, "_blank");
    }
  };

  const handleTestConnection = async () => {
    if (!serverUrl.trim()) {
      setError(t("serverConfig.enterServerUrl"));
      return;
    }

    setTesting(true);
    setError(null);

    try {
      let normalizedUrl = serverUrl.trim();
      if (
        !normalizedUrl.startsWith("http://") &&
        !normalizedUrl.startsWith("https://")
      ) {
        normalizedUrl = `http://${normalizedUrl}`;
      }

      const result = await testServerConnection(normalizedUrl);

      if (result.success) {
        setConnectionStatus("success");
      } else {
        setConnectionStatus("error");
        setError(result.error || t("serverConfig.connectionFailed"));
      }
    } catch (error) {
      setConnectionStatus("error");
      setError(t("serverConfig.connectionError"));
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!serverUrl.trim()) {
      setError(t("serverConfig.enterServerUrl"));
      return;
    }

    if (connectionStatus !== "success") {
      setError(t("serverConfig.testConnectionFirst"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let normalizedUrl = serverUrl.trim();
      if (
        !normalizedUrl.startsWith("http://") &&
        !normalizedUrl.startsWith("https://")
      ) {
        normalizedUrl = `http://${normalizedUrl}`;
      }

      const config: ServerConfig = {
        serverUrl: normalizedUrl,
        lastUpdated: new Date().toISOString(),
      };

      const success = await saveServerConfig(config);

      if (success) {
        onServerConfigured(normalizedUrl);
      } else {
        setError(t("serverConfig.saveFailed"));
      }
    } catch (error) {
      setError(t("serverConfig.saveError"));
    } finally {
      setLoading(false);
    }
  };

  const handleUrlChange = (value: string) => {
    setServerUrl(value);
    setConnectionStatus("unknown");
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
          <Server className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">{t("serverConfig.title")}</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {t("serverConfig.description")}
        </p>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="server-url">{t("serverConfig.serverUrl")}</Label>
          <div className="flex space-x-2">
            <Input
              id="server-url"
              type="text"
              placeholder="http://localhost:30001 or https://your-server.com"
              value={serverUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="flex-1 h-10"
              disabled={loading}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !serverUrl.trim() || loading}
              className="w-10 h-10 p-0 flex items-center justify-center"
            >
              {testing ? (
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : (
                <Wifi className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {connectionStatus !== "unknown" && (
          <div className="flex items-center space-x-2 text-sm">
            {connectionStatus === "success" ? (
              <>
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-green-600">
                  {t("serverConfig.connected")}
                </span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-red-500" />
                <span className="text-red-600">
                  {t("serverConfig.disconnected")}
                </span>
              </>
            )}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>{t("common.error")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Version Check Section */}
        {versionInfo && !versionDismissed && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                {t("versionCheck.checkUpdates")}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={checkForUpdates}
                disabled={versionChecking}
                className="h-6 px-2"
              >
                {versionChecking ? (
                  <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
              </Button>
            </div>
            <VersionAlert
              updateInfo={versionInfo}
              onDismiss={handleVersionDismiss}
              onDownload={handleDownloadUpdate}
              showDismiss={true}
            />
          </div>
        )}

        <div className="flex space-x-2">
          {onCancel && !isFirstTime && (
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            className={onCancel && !isFirstTime ? "flex-1" : "w-full"}
            onClick={handleSaveConfig}
            disabled={loading || testing || connectionStatus !== "success"}
          >
            {loading ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{t("serverConfig.saving")}</span>
              </div>
            ) : (
              t("serverConfig.saveConfig")
            )}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground text-center">
          {t("serverConfig.helpText")}
        </div>
      </div>
    </div>
  );
}
