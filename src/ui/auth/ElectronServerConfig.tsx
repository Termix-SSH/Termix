import React, { useState, useEffect } from "react";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { Label } from "@/components/label.tsx";
import { Alert, AlertTitle, AlertDescription } from "@/components/alert.tsx";
import { useTranslation } from "react-i18next";
import {
  getServerConfig,
  saveServerConfig,
  getEmbeddedServerStatus,
  setEmbeddedMode,
  type ServerConfig,
} from "@/main-axios.ts";
import { Server, Monitor, Loader2 } from "lucide-react";

interface ServerConfigProps {
  onServerConfigured: (serverUrl: string) => void;
  onUseEmbedded?: () => void;
  onCancel?: () => void;
  isFirstTime?: boolean;
}

export function ElectronServerConfig({
  onServerConfigured,
  onUseEmbedded,
  onCancel,
  isFirstTime = false,
}: ServerConfigProps) {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [embeddedLoading, setEmbeddedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embeddedAvailable, setEmbeddedAvailable] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    loadServerConfig();
    checkEmbeddedBackend();
  }, []);

  const loadServerConfig = async () => {
    try {
      const config = await getServerConfig();
      if (config?.serverUrl) {
        setServerUrl(config.serverUrl);
      }
    } catch (error) {
      console.error("Server config operation failed:", error);
    }
  };

  const checkEmbeddedBackend = async () => {
    try {
      const status = await getEmbeddedServerStatus();
      setEmbeddedAvailable(!!status?.embedded);
    } catch {
      setEmbeddedAvailable(true);
    }
  };

  const probeBackend = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch("http://localhost:30001/health", {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      clearTimeout(timer);
    }
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), 3000);
    try {
      await fetch("http://localhost:30001/version", {
        signal: controller2.signal,
      });
      clearTimeout(timer2);
      return true;
    } catch {
      clearTimeout(timer2);
      return false;
    }
  };

  const handleUseEmbedded = async () => {
    setEmbeddedLoading(true);
    setError(null);

    try {
      await new Promise((r) => setTimeout(r, 1500));
      const maxRetries = 15;
      for (let i = 0; i < maxRetries; i++) {
        if (await probeBackend()) {
          setEmbeddedMode(true);
          if (onUseEmbedded) {
            onUseEmbedded();
          } else {
            onServerConfigured("http://localhost:30001");
          }
          return;
        }
        if (i < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      setError(t("serverConfig.embeddedNotReady"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("serverConfig.embeddedNotReady"),
      );
    } finally {
      setEmbeddedLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!serverUrl.trim()) {
      setError(t("serverConfig.enterServerUrl"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const normalizedUrl = serverUrl.trim();

      if (
        !normalizedUrl.startsWith("http://") &&
        !normalizedUrl.startsWith("https://")
      ) {
        setError(t("serverConfig.mustIncludeProtocol"));
        setLoading(false);
        return;
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

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background p-6">
      <div className="flex flex-col gap-5 p-6 border border-border bg-card max-w-md w-full">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <Server className="size-4 text-accent-brand shrink-0" />
            <p className="font-bold">{t("serverConfig.title")}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("serverConfig.description")}
          </p>
        </div>

        {embeddedAvailable !== false && (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleUseEmbedded}
              disabled={embeddedLoading || loading}
            >
              {embeddedLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  {t("serverConfig.embeddedConnecting")}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Monitor className="size-4" />
                  {t("serverConfig.useEmbedded")}
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30">
                    BETA
                  </span>
                </span>
              )}
            </Button>
            <p className="text-xs text-muted-foreground -mt-3">
              {t("serverConfig.embeddedDesc")}
            </p>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">
                {t("common.or") || "OR"}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="server-url">{t("serverConfig.serverUrl")}</Label>
            <Input
              id="server-url"
              type="text"
              placeholder="https://your-server.com"
              value={serverUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              disabled={loading || embeddedLoading}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>{t("common.error")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            {onCancel && !isFirstTime && (
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={onCancel}
                disabled={loading || embeddedLoading}
              >
                {t("common.cancel")}
              </Button>
            )}
            <Button
              type="button"
              className={`bg-accent-brand hover:bg-accent-brand/90 text-background font-bold ${onCancel && !isFirstTime ? "flex-1" : "w-full"}`}
              onClick={handleSaveConfig}
              disabled={loading || embeddedLoading || !serverUrl.trim()}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                  {t("serverConfig.saving")}
                </span>
              ) : (
                t("serverConfig.saveConfig")
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {t("serverConfig.helpText")}
          </p>
        </div>
      </div>
    </div>
  );
}
