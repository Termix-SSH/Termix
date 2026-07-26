import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { isElectron } from "@/lib/electron";

interface RemoteSyncStatus {
  connected: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  needsReauth: boolean;
}

// Non-blocking banner shown when a connected remote sync server needs
// re-authentication. Never gates or hides any other UI -- the local app
// keeps working fully regardless of remote sync state.
export function RemoteSyncBanner({ onReconnect }: { onReconnect: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RemoteSyncStatus | null>(null);

  useEffect(() => {
    if (!isElectron()) return;
    window.electronAPI
      ?.invoke?.("get-remote-sync-status")
      .then((s) => setStatus((s as RemoteSyncStatus) ?? null))
      .catch(() => {});
    const unsubscribe = window.electronAPI?.onRemoteSyncStatusChanged?.(
      (nextStatus: RemoteSyncStatus) => setStatus(nextStatus),
    );
    return () => unsubscribe?.();
  }, []);

  if (!status?.connected || !status.needsReauth) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30 text-xs">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-3.5 text-yellow-600 dark:text-yellow-400 shrink-0" />
        <span>{t("remoteSync.bannerMessage")}</span>
      </div>
      <button
        type="button"
        onClick={onReconnect}
        className="font-bold text-accent-brand hover:text-accent-brand/70 transition-colors shrink-0"
      >
        {t("remoteSync.bannerReconnect")}
      </button>
    </div>
  );
}
