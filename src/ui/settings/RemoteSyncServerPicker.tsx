import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { Label } from "@/components/label.tsx";
import { Alert, AlertTitle, AlertDescription } from "@/components/alert.tsx";
import { Switch } from "@/components/switch.tsx";
import { useTranslation } from "react-i18next";
import { ChevronDown, X } from "lucide-react";

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

interface RemoteSyncServerPickerProps {
  onServerConfigured: (serverUrl: string) => void;
  onCancel: () => void;
}

export function RemoteSyncServerPicker({
  onServerConfigured,
  onCancel,
}: RemoteSyncServerPickerProps) {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState("");
  const [allowInvalidCertificate, setAllowInvalidCertificate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedUrls, setSavedUrls] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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

  const handleSaveConfig = async () => {
    if (!serverUrl.trim()) {
      setError(t("remoteSync.enterServerUrl"));
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
        setError(t("remoteSync.mustIncludeProtocol"));
        setLoading(false);
        return;
      }

      const result = await window.electronAPI?.invoke?.(
        "save-remote-sync-config",
        {
          serverUrl: normalizedUrl,
          allowInvalidCertificate:
            normalizedUrl.startsWith("https://") && allowInvalidCertificate,
          connectedAt: new Date().toISOString(),
        },
      );

      if ((result as { success?: boolean })?.success) {
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
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <p className="font-bold">{t("remoteSync.title")}</p>
        <p className="text-sm text-muted-foreground">
          {t("remoteSync.description")}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="remote-sync-server-url">
            {t("remoteSync.serverUrl")}
          </Label>
          <div className="relative" ref={dropdownRef}>
            <Input
              id="remote-sync-server-url"
              type="text"
              placeholder="https://your-server.com"
              value={serverUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              disabled={loading}
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
                disabled={loading}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={t("remoteSync.savedServers")}
              >
                <ChevronDown className="size-4" />
              </button>
            )}
            {dropdownOpen && savedUrls.length > 0 && (
              <div className="absolute z-50 w-full top-full mt-1 border border-border bg-card shadow-md">
                <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border">
                  {t("remoteSync.savedServers")}
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
                      title={t("remoteSync.removeServer")}
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
              <Label htmlFor="remote-sync-allow-invalid-certificate">
                {t("remoteSync.allowInvalidCertificate")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("remoteSync.allowInvalidCertificateDesc")}
              </p>
            </div>
            <Switch
              id="remote-sync-allow-invalid-certificate"
              checked={allowInvalidCertificate}
              onCheckedChange={setAllowInvalidCertificate}
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

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={loading}
          >
            {t("remoteSync.cancelButton")}
          </Button>
          <Button
            type="button"
            className="flex-1 bg-accent-brand hover:bg-accent-brand/90 text-background font-bold"
            onClick={handleSaveConfig}
            disabled={loading || !serverUrl.trim()}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                {t("serverConfig.saving")}
              </span>
            ) : (
              t("remoteSync.continueButton")
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
