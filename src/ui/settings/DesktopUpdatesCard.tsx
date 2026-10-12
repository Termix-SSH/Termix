import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ExternalLink, MonitorDown } from "lucide-react";
import { Button } from "@/components/button";
import { SectionCard, SettingRow } from "@/components/section-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import {
  canConfigureUpdates,
  desktopUpdates,
  useDesktopUpdate,
  type DesktopUpdateMode,
  type DesktopUpdateState,
} from "@/lib/desktop-updates";

const MODES: DesktopUpdateMode[] = ["automatic", "prompt", "never"];

function StatusText({ state }: { state: DesktopUpdateState }) {
  const { t } = useTranslation();
  const version = state.version;
  switch (state.status) {
    case "checking":
      return <>{t("desktopUpdates.statusChecking")}</>;
    case "available":
      return <>{t("desktopUpdates.statusAvailable", { version })}</>;
    case "downloading":
      return (
        <>
          {t("desktopUpdates.statusDownloading", {
            version,
            progress: state.progress ?? 0,
          })}
        </>
      );
    case "downloaded":
      return <>{t("desktopUpdates.statusReady", { version })}</>;
    case "up-to-date":
      return <>{t("desktopUpdates.statusUpToDate")}</>;
    case "error":
      return <>{t("desktopUpdates.statusError")}</>;
    default:
      return <>{t("desktopUpdates.statusIdle")}</>;
  }
}

/** Desktop only: how this install updates itself. */
export function DesktopUpdatesCard() {
  const { t } = useTranslation();
  const state = useDesktopUpdate();
  const [busy, setBusy] = useState(false);

  if (!canConfigureUpdates(state)) return null;
  const bridge = desktopUpdates();

  const run = async (action: () => Promise<unknown> | undefined) => {
    setBusy(true);
    try {
      await action();
    } catch {
      toast.error(t("settings.updates.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const modeLabel = (mode: DesktopUpdateMode) =>
    mode === "automatic"
      ? t("desktopUpdates.modeAutomatic")
      : mode === "prompt"
        ? t("desktopUpdates.modePrompt")
        : t("desktopUpdates.modeNever");

  return (
    <SectionCard
      title={t("desktopUpdates.title")}
      icon={<MonitorDown className="size-3.5" />}
      rowId="updates-desktop"
    >
      <SettingRow
        label={t("desktopUpdates.mode")}
        description={
          state.kind === "manual"
            ? t("desktopUpdates.manualModeHint")
            : t("desktopUpdates.modeHint")
        }
      >
        <Select
          disabled={busy}
          value={state.mode}
          onValueChange={(next) =>
            void run(() => bridge?.setMode(next as DesktopUpdateMode))
          }
        >
          <SelectTrigger className="h-8 w-40 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {modeLabel(mode)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label={t("desktopUpdates.status", { version: state.currentVersion })}
        description={<StatusText state={state} />}
      >
        {state.status === "downloaded" ? (
          <Button
            size="sm"
            className="h-8"
            onClick={() => void bridge?.install()}
          >
            {t("desktopUpdates.restart")}
          </Button>
        ) : state.status === "available" && state.kind === "auto" ? (
          <Button
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => void run(() => bridge?.download())}
          >
            {t("desktopUpdates.download")}
          </Button>
        ) : state.status === "available" && state.releaseUrl ? (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" asChild>
            <a
              href={state.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("desktopUpdates.download")}
              <ExternalLink className="size-3" />
            </a>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={
              busy ||
              state.status === "checking" ||
              state.status === "downloading"
            }
            onClick={() => void run(() => bridge?.check())}
          >
            {t("desktopUpdates.checkNow")}
          </Button>
        )}
      </SettingRow>
    </SectionCard>
  );
}
