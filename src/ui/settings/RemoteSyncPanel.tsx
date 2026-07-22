import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Server, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog.tsx";
import { RemoteSyncServerPicker } from "./RemoteSyncServerPicker.tsx";
import { ElectronLoginForm } from "@/auth/ElectronLoginForm.tsx";

interface RemoteSyncConfig {
  serverUrl: string;
  connectedAt: string;
  lastSyncedAt?: string | null;
  lastSyncStatus?: "ok" | "error" | "never";
  lastSyncError?: string | null;
}

interface RemoteSyncStatus {
  connected: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  needsReauth: boolean;
}

type DesktopSettings = { defaultConnectionOrigin: "local" | "remote" };

export function RemoteSyncPanel() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<RemoteSyncConfig | null>(null);
  const [status, setStatus] = useState<RemoteSyncStatus | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings>({
    defaultConnectionOrigin: "local",
  });
  const [step, setStep] = useState<"idle" | "picker" | "login">("idle");
  const [pendingServerUrl, setPendingServerUrl] = useState("");
  const [syncingNow, setSyncingNow] = useState(false);

  const refresh = useCallback(async () => {
    const [cfg, st, settings] = await Promise.all([
      window.electronAPI?.invoke?.(
        "get-remote-sync-config",
      ) as Promise<RemoteSyncConfig | null>,
      window.electronAPI?.invoke?.(
        "get-remote-sync-status",
      ) as Promise<RemoteSyncStatus | null>,
      window.electronAPI?.invoke?.(
        "get-desktop-settings",
      ) as Promise<DesktopSettings>,
    ]);
    setConfig(cfg ?? null);
    setStatus(st ?? null);
    if (settings) setDesktopSettings(settings);
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = window.electronAPI?.onRemoteSyncStatusChanged?.(
      (nextStatus: RemoteSyncStatus) => setStatus(nextStatus),
    );
    return () => unsubscribe?.();
  }, [refresh]);

  const handleConnectClick = () => setStep("picker");

  const handleServerConfigured = (serverUrl: string) => {
    setPendingServerUrl(serverUrl);
    setStep("login");
  };

  const handleAuthSuccess = async () => {
    setStep("idle");
    await refresh();
  };

  const handleDisconnect = async () => {
    await window.electronAPI?.invoke?.("clear-remote-sync-config");
    await refresh();
  };

  const handleSyncNow = async () => {
    setSyncingNow(true);
    try {
      await window.electronAPI?.invoke?.("remote-sync-now");
    } finally {
      setSyncingNow(false);
      await refresh();
    }
  };

  const handleOriginChange = async (origin: "local" | "remote") => {
    const next = { ...desktopSettings, defaultConnectionOrigin: origin };
    setDesktopSettings(next);
    await window.electronAPI?.invoke?.("save-desktop-settings", next);
  };

  const isConnected = !!config?.serverUrl;

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-border bg-muted/10 p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-accent-brand" />
          <p className="font-bold text-sm">{t("remoteSync.title")}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("remoteSync.description")}
        </p>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="flex flex-col gap-0.5">
            {isConnected ? (
              <>
                <span className="text-xs font-medium">
                  {t("remoteSync.connectedTo", { url: config.serverUrl })}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {status?.needsReauth
                    ? t("remoteSync.needsReauth")
                    : status?.lastError
                      ? t("remoteSync.syncError", {
                          message: status.lastError,
                        })
                      : status?.lastSyncedAt
                        ? t("remoteSync.lastSynced", {
                            time: new Date(
                              status.lastSyncedAt,
                            ).toLocaleString(),
                          })
                        : t("remoteSync.neverSynced")}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t("remoteSync.notConnected")}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isConnected ? (
              <>
                {status?.needsReauth && (
                  <Button
                    type="button"
                    size="sm"
                    className="text-[10px] h-7"
                    onClick={handleConnectClick}
                  >
                    {t("remoteSync.bannerReconnect")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-[10px] h-7"
                  onClick={handleSyncNow}
                  disabled={syncingNow || status?.syncing}
                >
                  {syncingNow || status?.syncing ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  {t("remoteSync.syncNowButton")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-[10px] h-7"
                  onClick={handleDisconnect}
                >
                  {t("remoteSync.disconnectButton")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-[10px] h-7"
                onClick={handleConnectClick}
              >
                <Server className="size-3" />
                {t("remoteSync.connectButton")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="border border-border bg-muted/10 p-4 flex flex-col gap-3">
        <p className="font-bold text-sm">{t("remoteSync.originTitle")}</p>
        <p className="text-xs text-muted-foreground">
          {t("remoteSync.originDescription")}
        </p>
        <div className="flex border border-border overflow-hidden w-fit">
          <button
            type="button"
            onClick={() => handleOriginChange("local")}
            className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors ${
              desktopSettings.defaultConnectionOrigin === "local"
                ? "bg-accent-brand text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {t("remoteSync.originLocal")}
          </button>
          <button
            type="button"
            onClick={() => handleOriginChange("remote")}
            disabled={!isConnected}
            className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              desktopSettings.defaultConnectionOrigin === "remote"
                ? "bg-accent-brand text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {t("remoteSync.originRemote")}
          </button>
        </div>
      </div>

      <Dialog
        open={step === "picker"}
        onOpenChange={(open) => !open && setStep("idle")}
      >
        <DialogContent className="bg-card border border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="sr-only">
              {t("remoteSync.title")}
            </DialogTitle>
          </DialogHeader>
          <RemoteSyncServerPicker
            onServerConfigured={handleServerConfigured}
            onCancel={() => setStep("idle")}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={step === "login"}
        onOpenChange={(open) => !open && setStep("idle")}
      >
        <DialogContent className="bg-card border border-border max-w-4xl h-[80vh] flex flex-col p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>
              {t("remoteSync.signInTitle", { url: pendingServerUrl })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <ElectronLoginForm
              serverUrl={pendingServerUrl}
              targetPurpose="remoteSync"
              onAuthSuccess={handleAuthSuccess}
              onChangeServer={() => setStep("picker")}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
