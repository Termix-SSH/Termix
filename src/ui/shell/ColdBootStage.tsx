import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/button";
import { getColdBoot, subscribeColdBoot } from "@/plugin-host/frames/cold-boot";

/** Fewer cold plugins than this fill in quietly. */
export const COLD_STAGE_MIN = 5;

/** Plugin start progress under the app's loading screen. */
export function BootProgress() {
  const { t } = useTranslation();
  const boot = useSyncExternalStore(subscribeColdBoot, getColdBoot);
  if (boot.total < COLD_STAGE_MIN || boot.done >= boot.total) return null;
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="text-xs text-muted-foreground">
        {t("plugins.firstLoad.title")}
      </p>
      <div className="h-1 w-56 max-w-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${Math.round((boot.done / boot.total) * 100)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("plugins.firstLoad.progress", {
          done: boot.done,
          total: boot.total,
        })}
      </p>
    </div>
  );
}

/**
 * The first run on a browser or device with nothing cached: plugins start
 * one after another to learn what they add. One plain screen says so, instead
 * of a shell that keeps changing under the user. Shown once per page load.
 */
export function ColdBootStage() {
  const { t } = useTranslation();
  const boot = useSyncExternalStore(subscribeColdBoot, getColdBoot);
  const [closed, setClosed] = useState(false);
  const finished = useRef(false);
  const busy = boot.total > boot.done;

  useEffect(() => {
    if (boot.total > 0 && !busy) finished.current = true;
  }, [boot.total, busy]);

  if (closed || finished.current || !busy || boot.total < COLD_STAGE_MIN) {
    return null;
  }
  const percent = Math.round((boot.done / boot.total) * 100);
  return (
    <div
      role="status"
      data-slot="cold-boot-stage"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background px-4 text-center"
    >
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">
        {t("plugins.firstLoad.title")}
      </p>
      <div className="h-1 w-56 max-w-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("plugins.firstLoad.progress", {
          done: boot.done,
          total: boot.total,
        })}
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {t("plugins.firstLoad.hint")}
      </p>
      <Button variant="ghost" size="sm" onClick={() => setClosed(true)}>
        {t("plugins.firstLoad.skip")}
      </Button>
    </div>
  );
}
