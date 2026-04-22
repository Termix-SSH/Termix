import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { useTranslation } from "react-i18next";
import {
  getBackendConfig,
  saveBackendConfig,
  getEmbeddedServerStatus,
  testServerConnection,
  type BackendMode,
  type ElectronBackendConfig,
  type EmbeddedServerStatus,
} from "@/ui/main-axios.ts";
import { Server } from "lucide-react";

interface ServerConfigProps {
  onServerConfigured: (serverUrl: string) => void;
  onUseEmbedded?: () => void;
  onCancel?: () => void;
  isFirstTime?: boolean;
  layout?: "shell" | "embedded";
}

export function ElectronServerConfig({
  onServerConfigured,
  onUseEmbedded,
  onCancel,
  isFirstTime = false,
  layout = "shell",
}: ServerConfigProps) {
  const { t } = useTranslation();
  const [backendMode, setBackendMode] = useState<BackendMode>("embedded");
  const [serverUrl, setServerUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embeddedStatus, setEmbeddedStatus] =
    useState<EmbeddedServerStatus | null>(null);

  useEffect(() => {
    loadServerConfig();
  }, []);

  const loadServerConfig = async () => {
    try {
      const [config, status] = await Promise.all([
        getBackendConfig(),
        getEmbeddedServerStatus(),
      ]);
      const embeddedAvailable = !!(status?.available ?? status?.embedded);

      setEmbeddedStatus(status);

      if (config?.backendMode === "remote" && config.remoteServerUrl) {
        setBackendMode("remote");
        setServerUrl(config.remoteServerUrl);
      } else if (embeddedAvailable) {
        setBackendMode("embedded");
      } else {
        setBackendMode("remote");
      }
    } catch (error) {
      console.error("Server config operation failed:", error);
      setEmbeddedStatus(null);
    }
  };

  const getEmbeddedUnavailableMessage = () => {
    if (embeddedStatus?.reason === "startup_failed") {
      return t("serverConfig.embeddedBackendStartupFailed");
    }

    if (embeddedStatus?.reason === "missing_backend_build") {
      return t("serverConfig.embeddedBackendMissing");
    }

    return t("serverConfig.serverModeEmbeddedUnavailable");
  };

  const handleSaveConfig = async () => {
    setLoading(true);
    setError(null);

    try {
      if (backendMode === "embedded") {
        const result = await saveBackendConfig({
          backendMode: "embedded",
          remoteServerUrl: null,
          lastUpdated: new Date().toISOString(),
        });

        if (result.success) {
          if (onUseEmbedded) {
            onUseEmbedded();
          } else {
            onServerConfigured("http://localhost:30001");
          }
        } else {
          setError(result.error || t("serverConfig.saveFailed"));
        }

        return;
      }

      if (!serverUrl.trim()) {
        setError(t("serverConfig.enterServerUrl"));
        setLoading(false);
        return;
      }

      const normalizedUrl = serverUrl.trim().replace(/\/$/, "");

      if (
        !normalizedUrl.startsWith("http://") &&
        !normalizedUrl.startsWith("https://")
      ) {
        setError(t("serverConfig.mustIncludeProtocol"));
        setLoading(false);
        return;
      }

      const connectionResult = await testServerConnection(normalizedUrl);
      if (!connectionResult.success) {
        setError(connectionResult.error || t("serverConfig.connectionFailed"));
        setLoading(false);
        return;
      }

      const config: ElectronBackendConfig = {
        backendMode: "remote",
        remoteServerUrl: normalizedUrl,
        lastUpdated: new Date().toISOString(),
      };

      const result = await saveBackendConfig(config);

      if (result.success) {
        onServerConfigured(normalizedUrl);
      } else {
        setError(result.error || t("serverConfig.saveFailed"));
      }
    } catch {
      setError(t("serverConfig.saveError"));
    } finally {
      setLoading(false);
    }
  };

  const handleUrlChange = (value: string) => {
    setServerUrl(value);
    setError(null);
  };

  const handleModeChange = (value: BackendMode) => {
    setBackendMode(value);
    setError(null);
  };

  const cardContent = (
    <div
      className={`w-[420px] max-w-full p-8 flex flex-col backdrop-blur-sm bg-card/50 rounded-2xl shadow-xl border-2 border-edge overflow-y-auto thin-scrollbar animate-in fade-in zoom-in-95 duration-300 ${
        layout === "embedded" ? "my-2" : ""
      }`}
    >
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
            <Label htmlFor="server-mode">{t("serverConfig.serverMode")}</Label>
            <Select
              value={backendMode}
              onValueChange={(value) => handleModeChange(value as BackendMode)}
              disabled={loading}
            >
              <SelectTrigger id="server-mode" className="w-full h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="embedded"
                  disabled={embeddedStatus?.available === false}
                >
                  {t("serverConfig.serverModeEmbedded")}
                </SelectItem>
                <SelectItem value="remote">
                  {t("serverConfig.serverModeRemote")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {backendMode === "embedded" && embeddedStatus?.available === false
                ? t("serverConfig.serverModeEmbeddedUnavailable")
                : backendMode === "embedded"
                  ? t("serverConfig.serverModeEmbeddedDesc")
                  : t("serverConfig.serverModeRemoteDesc")}
            </p>
          </div>

          {embeddedStatus?.available === false && (
            <Alert>
              <AlertTitle>
                {t("serverConfig.serverModeEmbeddedUnavailable")}
              </AlertTitle>
              <AlertDescription>
                {getEmbeddedUnavailableMessage()}
              </AlertDescription>
            </Alert>
          )}

          {backendMode === "remote" && (
            <div className="space-y-2">
              <Label htmlFor="server-url">{t("serverConfig.serverUrl")}</Label>
              <Input
                id="server-url"
                type="text"
                placeholder="https://your-server.com"
                value={serverUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                className="w-full h-10"
                disabled={loading}
              />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>{t("common.error")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
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
              variant="outline"
              className={onCancel && !isFirstTime ? "flex-1" : "w-full"}
              onClick={handleSaveConfig}
              disabled={
                loading || (backendMode === "remote" && !serverUrl.trim())
              }
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
            {backendMode === "embedded" && embeddedStatus?.available === false
              ? getEmbeddedUnavailableMessage()
              : backendMode === "embedded"
                ? t("serverConfig.serverModeEmbeddedDesc")
                : t("serverConfig.helpText")}
          </div>
        </div>
      </div>
    </div>
  );

  return cardContent;
}
