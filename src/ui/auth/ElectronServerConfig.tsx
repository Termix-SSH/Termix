import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { Label } from "@/components/label.tsx";
import { Alert, AlertTitle, AlertDescription } from "@/components/alert.tsx";
import { Switch } from "@/components/switch.tsx";
import { useTranslation } from "react-i18next";
import {
  getServerConfig,
  saveServerConfig,
  getEmbeddedServerStatus,
  setEmbeddedMode,
  type ServerConfig,
} from "@/main-axios.ts";
import { Server, Monitor, Loader2, ChevronDown, X } from "lucide-react";

const SAVED_URLS_KEY = "termix_saved_server_urls";
const MAX_SAVED_URLS = 5;

function getSavedUrls(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_URLS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function addSavedUrl(url: string) {
  const urls = getSavedUrls().filter((u) => u !== url);
  urls.unshift(url);
  localStorage.setItem(
    SAVED_URLS_KEY,
    JSON.stringify(urls.slice(0, MAX_SAVED_URLS)),
  );
}

function removeSavedUrl(url: string) {
  const urls = getSavedUrls().filter((u) => u !== url);
  localStorage.setItem(SAVED_URLS_KEY, JSON.stringify(urls));
}

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
  const [allowInvalidCertificate, setAllowInvalidCertificate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [embeddedLoading, setEmbeddedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embeddedAvailable, setEmbeddedAvailable] = useState<boolean | null>(
    null,
  );
  const [savedUrls, setSavedUrls] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadServerConfig();
    checkEmbeddedBackend();
    setSavedUrls(getSavedUrls());
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  const loadServerConfig = async () => {
    try {
      const config = await getServerConfig();
      if (config?.serverUrl) {
        setServerUrl(config.serverUrl);
      }
      setAllowInvalidCertificate(!!config?.allowInvalidCertificate);
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
        allowInvalidCertificate:
          normalizedUrl.startsWith("https://") && allowInvalidCertificate,
      };

      const success = await saveServerConfig(config);

      if (success) {
        addSavedUrl(normalizedUrl);
        setSavedUrls(getSavedUrls());
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
            <div className="relative" ref={dropdownRef}>
              <Input
                id="server-url"
                type="text"
                placeholder="https://your-server.com"
                value={serverUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                disabled={loading || embeddedLoading}
                className={savedUrls.length > 0 ? "pr-9" : ""}
                onFocus={() => {
                  if (savedUrls.length > 0) setDropdownOpen(true);
                }}
              />
              {savedUrls.length > 0 && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setDropdownOpen((o) => !o)}
                  disabled={loading || embeddedLoading}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={t("serverConfig.savedServers")}
                >
                  <ChevronDown className="size-4" />
                </button>
              )}
              {dropdownOpen && savedUrls.length > 0 && (
                <div className="absolute z-50 w-full top-full mt-1 border border-border bg-card shadow-md">
                  <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border">
                    {t("serverConfig.savedServers")}
                  </p>
                  {savedUrls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center justify-between group hover:bg-muted transition-colors"
                    >
                      <button
                        type="button"
                        className="flex-1 text-left px-2.5 py-2 text-sm font-mono truncate"
                        onClick={() => {
                          handleUrlChange(url);
                          setDropdownOpen(false);
                        }}
                      >
                        {url}
                      </button>
                      <button
                        type="button"
                        className="px-2 py-2 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        title={t("serverConfig.removeServer")}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSavedUrl(url);
                          const updated = getSavedUrls();
                          setSavedUrls(updated);
                          if (updated.length === 0) setDropdownOpen(false);
                        }}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {serverUrl.trim().startsWith("https://") && (
            <div className="flex items-start justify-between gap-3 border border-border bg-muted/20 p-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="allow-invalid-certificate">
                  {t("serverConfig.allowInvalidCertificate")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("serverConfig.allowInvalidCertificateDesc")}
                </p>
              </div>
              <Switch
                id="allow-invalid-certificate"
                checked={allowInvalidCertificate}
                onCheckedChange={setAllowInvalidCertificate}
                disabled={loading || embeddedLoading}
              />
            </div>
          )}

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
