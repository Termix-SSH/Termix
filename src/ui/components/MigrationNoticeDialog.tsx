import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Server } from "lucide-react";
import { isElectron } from "@/lib/electron";
import { Button } from "@/components/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/dialog.tsx";

type DesktopSettings = {
  defaultConnectionOrigin: "local" | "remote";
  migrationNoticeAcknowledged?: boolean;
};

// One-time notice for Electron installs that previously pointed the whole
// app at a remote Termix server (the pre-2.6.0 architecture). That install
// now runs a fully local, standalone backend by default -- the hosts,
// credentials, and snippets that lived on the old remote server won't show
// up here until the user explicitly turns on Remote Sync and reconnects to
// that same server. A fresh install never had a legacy serverUrl, so this
// never fires for anyone who didn't go through the old flow, and it only
// ever shows once per install (tracked in desktop-settings.json).
export function MigrationNoticeDialog({
  onOpenRemoteSync,
}: {
  onOpenRemoteSync: (serverUrl: string) => void;
}) {
  const { t } = useTranslation();
  const [legacyServerUrl, setLegacyServerUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isElectron()) return;
    let cancelled = false;

    Promise.all([
      window.electronAPI?.invoke?.("get-legacy-server-config") as Promise<{
        serverUrl: string | null;
      } | null>,
      window.electronAPI?.invoke?.("get-desktop-settings") as Promise<
        DesktopSettings | undefined
      >,
    ])
      .then(([legacyConfig, settings]) => {
        if (cancelled) return;
        const serverUrl = legacyConfig?.serverUrl || null;
        if (serverUrl && !settings?.migrationNoticeAcknowledged) {
          setLegacyServerUrl(serverUrl);
          setOpen(true);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const acknowledge = async () => {
    setOpen(false);
    const settings = ((await window.electronAPI?.invoke?.(
      "get-desktop-settings",
    )) as DesktopSettings | undefined) ?? { defaultConnectionOrigin: "local" };
    await window.electronAPI?.invoke?.("save-desktop-settings", {
      ...settings,
      migrationNoticeAcknowledged: true,
    });
  };

  const handleSetUpSync = async () => {
    const url = legacyServerUrl || "";
    await acknowledge();
    onOpenRemoteSync(url);
  };

  if (!legacyServerUrl) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && acknowledge()}>
      <DialogContent className="bg-card border border-border max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Server className="size-4 text-accent-brand" />
            <DialogTitle>{t("migrationNotice.title")}</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-foreground/90 pt-2 space-y-2">
            <p>{t("migrationNotice.body1")}</p>
            <p>{t("migrationNotice.body2", { url: legacyServerUrl })}</p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex items-center gap-2 sm:justify-between">
          <Button variant="outline" size="sm" onClick={acknowledge}>
            {t("migrationNotice.dismiss")}
          </Button>
          <Button size="sm" onClick={handleSetUpSync}>
            {t("migrationNotice.setUpSync")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
