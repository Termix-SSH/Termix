import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert.tsx";
import { useTranslation } from "react-i18next";
import {
  getServerConfig,
  saveServerConfig,
  getEmbeddedServerStatus,
  setEmbeddedMode,
  type ServerConfig,
} from "@/ui/main-axios.ts";
import { Server, Monitor, Loader2 } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

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
  const { theme } = useTheme();
  const [serverUrl, setServerUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [embeddedLoading, setEmbeddedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embeddedAvailable, setEmbeddedAvailable] = useState<boolean | null>(
    null,
  );

  const isDarkMode =
    theme === "dark" ||
    theme === "dracula" ||
    theme === "gentlemansChoice" ||
    theme === "midnightEspresso" ||
    theme === "catppuccinMocha" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const lineColor = isDarkMode ? "#151517" : "#f9f9f9";

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
      const maxRetries = 10;
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
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background: "var(--bg-elevated)",
        backgroundImage: `repeating-linear-gradient(
          45deg,
          transparent,
          transparent 35px,
          ${lineColor} 35px,
          ${lineColor} 37px
        )`,
      }}
    >
      <div className="w-[420px] max-w-full p-8 flex flex-col backdrop-blur-sm bg-card/50 rounded-2xl shadow-xl border-2 border-edge overflow-y-auto thin-scrollbar my-2 animate-in fade-in zoom-in-95 duration-300">
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

          {embeddedAvailable !== false && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleUseEmbedded}
                disabled={embeddedLoading || loading}
              >
                {embeddedLoading ? (
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t("serverConfig.embeddedConnecting")}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center space-x-2">
                    <Monitor className="w-4 h-4" />
                    <span>{t("serverConfig.useEmbedded")}</span>
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 rounded border border-yellow-500/30">
                      BETA
                    </span>
                  </div>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                {t("serverConfig.embeddedDesc")}
              </p>
            </div>
          )}

          {embeddedAvailable !== false && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">
                {t("common.or") || "OR"}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server-url">{t("serverConfig.serverUrl")}</Label>
              <Input
                id="server-url"
                type="text"
                placeholder="https://your-server.com"
                value={serverUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                className="w-full h-10"
                disabled={loading || embeddedLoading}
              />
            </div>

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
                  disabled={loading || embeddedLoading}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className={onCancel && !isFirstTime ? "flex-1" : "w-full"}
                onClick={handleSaveConfig}
                disabled={loading || embeddedLoading || !serverUrl.trim()}
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
      </div>
    </div>
  );
}
