import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  usePluginApi,
  useTranslation,
  type SettingsComponentProps,
} from "@termix/plugin-sdk/frontend";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useConfirmation,
} from "@termix/plugin-sdk/ui";

export interface TelemetryStatus {
  enabled: boolean;
  locked: boolean;
  instanceId: string | null;
  lastSentAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  nextDueAt: string | null;
}

function errorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { error?: string } } })?.response
    ?.data;
  if (data?.error) return data.error;
  return error instanceof Error ? error.message : String(error);
}

export function TelemetryStatusSetting({ running }: SettingsComponentProps) {
  const { t } = useTranslation();
  const api = usePluginApi();
  const { confirmWithToast } = useConfirmation();
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<TelemetryStatus>("/status");
      setStatus(data);
    } catch {
      setStatus(null);
      toast.error(t("status.loadFailed"));
    }
  }, [api, t]);

  useEffect(() => {
    if (running) void load();
  }, [running, load]);

  async function sendNow() {
    setSending(true);
    try {
      const { data } = await api.post<{ sent: boolean }>("/send");
      if (data.sent) toast.success(t("status.sent"));
      else toast.info(t("status.notSent"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSending(false);
      await load();
    }
  }

  async function showPreview() {
    try {
      const { data } = await api.get("/preview");
      setPreview(data);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function resetId() {
    void confirmWithToast(t("status.resetIdConfirm"), async () => {
      try {
        await api.post("/reset-id");
        toast.success(t("status.resetIdDone"));
        await load();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  let summary = t("status.off");
  if (status?.locked) {
    summary = status.enabled ? t("status.lockedOn") : t("status.lockedOff");
  } else if (status?.enabled) {
    summary = t("status.on");
  }

  const muted = "text-[10px] text-muted-foreground";

  return (
    <div className="flex flex-col gap-2 border border-border bg-background/50 p-2">
      <span className="text-xs font-medium">{t("status.title")}</span>
      {status && (
        <>
          <span className={muted}>{summary}</span>
          <span className={`${muted} break-all`}>
            {status.instanceId
              ? t("status.instanceId", { id: status.instanceId })
              : t("status.noInstanceId")}
          </span>
          <span className={muted}>
            {status.lastSentAt
              ? t("status.lastSent", {
                  date: new Date(status.lastSentAt).toLocaleString(),
                })
              : t("status.neverSent")}
          </span>
          {status.enabled && status.nextDueAt && (
            <span className={muted}>
              {t("status.nextSend", {
                date: new Date(status.nextDueAt).toLocaleString(),
              })}
            </span>
          )}
          {status.lastError && (
            <span className="text-[10px] text-destructive">
              {t("status.lastError", { error: status.lastError })}
            </span>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="rounded-none"
          disabled={!running}
          onClick={showPreview}
        >
          {t("status.preview")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-none"
          disabled={!running || sending || !status?.enabled}
          onClick={sendNow}
        >
          {sending ? t("status.sending") : t("status.sendNow")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-none"
          disabled={!running}
          onClick={resetId}
        >
          {t("status.resetId")}
        </Button>
      </div>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
      >
        <DialogContent className="rounded-none sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("status.previewTitle")}</DialogTitle>
            <DialogDescription>
              {t("status.previewDescription")}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto border border-border bg-muted/40 p-2 text-[11px]">
            {JSON.stringify(preview, null, 2)}
          </pre>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={() => setPreview(null)}
            >
              {t("status.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
