import { useTranslation } from "react-i18next";
import { ImageIcon } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import type {
  TerminalImageStorageMode,
  TerminalImageStorageSettings,
  TerminalImageStorageTestResult,
} from "@/api/settings-api";
import { AccordionSection } from "./AdminSettingsShared";

const MODE_LABEL_KEYS: Record<TerminalImageStorageMode, string> = {
  auto: "admin.imageStorageModeAuto",
  local: "admin.imageStorageModeLocal",
  "remote-sftp": "admin.imageStorageModeRemoteSftp",
};

const SELECTED_MODE_LABEL_KEYS: Record<
  TerminalImageStorageTestResult["selectedMode"],
  string
> = {
  local: "admin.imageStorageModeLocal",
  "remote-sftp": "admin.imageStorageModeRemoteSftp",
  unavailable: "admin.imageStorageSelectedModeUnavailable",
};

export function AdminImageStorageSection({
  open,
  onToggle,
  settings,
  setSettings,
  localDir,
  setLocalDir,
  instanceId,
  setInstanceId,
  saving,
  testing,
  testResult,
  onSave,
  onTest,
}: {
  open: boolean;
  onToggle: () => void;
  settings: TerminalImageStorageSettings | null;
  setSettings: (settings: TerminalImageStorageSettings) => void;
  localDir: string;
  setLocalDir: (value: string) => void;
  instanceId: string;
  setInstanceId: (value: string) => void;
  saving: boolean;
  testing: boolean;
  testResult: TerminalImageStorageTestResult | null;
  onSave: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation();

  return (
    <AccordionSection
      label={t("admin.sectionImageStorage")}
      icon={<ImageIcon className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      {settings === null ? (
        <div className="pt-3 text-xs text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : (
        <div className="@container flex flex-col gap-0 pt-2">
          <div className="flex flex-col gap-2 py-3 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-snug">
                {t("admin.imageStorageMode")}
              </span>
              <span className="text-xs text-muted-foreground leading-snug">
                {t("admin.imageStorageModeDesc")}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(MODE_LABEL_KEYS) as TerminalImageStorageMode[]).map(
                (mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={settings.mode === mode}
                    onClick={() => setSettings({ ...settings, mode })}
                    className={`whitespace-nowrap px-2 py-1 text-[10px] font-semibold border transition-colors ${settings.mode === mode ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {t(MODE_LABEL_KEYS[mode])}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-x-4 gap-y-3 py-3 @md:grid-cols-2 border-b border-border">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">
                {t("admin.imageStorageLocalDir")}
              </span>
              <Input
                aria-label={t("admin.imageStorageLocalDir")}
                value={localDir}
                placeholder={t("admin.imageStorageLocalDirPlaceholder")}
                onChange={(event) => setLocalDir(event.target.value)}
                className="h-8 text-xs"
              />
              <span className="text-muted-foreground">
                {t("admin.imageStorageLocalDirDesc")}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">
                {t("admin.imageStorageHostPath")}
              </span>
              <Input
                aria-label={t("admin.imageStorageHostPath")}
                value={settings.hostPath}
                onChange={(event) =>
                  setSettings({ ...settings, hostPath: event.target.value })
                }
                className="h-8 text-xs"
              />
              <span className="text-muted-foreground">
                {t("admin.imageStorageHostPathDesc")}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">
                {t("admin.imageStorageTtl")}
              </span>
              <Input
                aria-label={t("admin.imageStorageTtl")}
                type="number"
                min={0}
                value={settings.ttlMs}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    ttlMs: Number(event.target.value),
                  })
                }
                className="h-8 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">
                {t("admin.imageStorageMaxCount")}
              </span>
              <Input
                aria-label={t("admin.imageStorageMaxCount")}
                type="number"
                min={1}
                value={settings.maxCount}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    maxCount: Number(event.target.value),
                  })
                }
                className="h-8 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">
                {t("admin.imageStorageMaxBytes")}
              </span>
              <Input
                aria-label={t("admin.imageStorageMaxBytes")}
                type="number"
                min={1048576}
                value={settings.maxBytes}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    maxBytes: Number(event.target.value),
                  })
                }
                className="h-8 text-xs"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2 py-3 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-snug">
                {t("admin.imageStorageInstanceId")}
              </span>
              <span className="text-xs text-muted-foreground leading-snug">
                {t("admin.imageStorageInstanceIdDesc")}
              </span>
            </div>
            <Input
              aria-label={t("admin.imageStorageInstanceId")}
              value={instanceId}
              onChange={(event) => setInstanceId(event.target.value)}
              className="h-8 w-full @md:w-64 text-xs"
            />
          </div>

          {testResult && (
            <div className="py-2 text-xs text-muted-foreground border-b border-border">
              <div>
                {testResult.connected
                  ? t("admin.imageStorageTestConnected")
                  : t("admin.imageStorageTestNotConnected")}
              </div>
              <div>
                {t("admin.imageStorageTestSelectedMode", {
                  mode: t(SELECTED_MODE_LABEL_KEYS[testResult.selectedMode]),
                })}
              </div>
              {testResult.localHostVisible !== null && (
                <div>
                  {testResult.localHostVisible
                    ? t("admin.imageStorageTestLocalVisible")
                    : t("admin.imageStorageTestLocalNotVisible")}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-3">
            <Button
              size="sm"
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? t("common.saving") : t("common.save")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={testing}
              onClick={onTest}
            >
              {testing
                ? t("admin.imageStorageTesting")
                : t("admin.imageStorageTest")}
            </Button>
          </div>
        </div>
      )}
    </AccordionSection>
  );
}
