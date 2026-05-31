import { useTranslation } from "react-i18next";
import { Box, FolderSearch } from "lucide-react";

import { Input } from "@/components/input";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import type { HostEditorForm } from "./HostEditorData";

type SetHostField = <K extends keyof HostEditorForm>(
  key: K,
  value: HostEditorForm[K],
) => void;

export function HostDockerTab({
  form,
  setField,
}: {
  form: HostEditorForm;
  setField: SetHostField;
}) {
  const { t } = useTranslation();

  return (
    <SectionCard
      title={t("hosts.dockerIntegration")}
      icon={<Box className="size-3.5" />}
    >
      <div className="flex flex-col gap-4 py-3">
        <SettingRow
          label={t("hosts.enableDockerMonitor")}
          description={t("hosts.enableDockerMonitorDesc")}
        >
          <FakeSwitch
            checked={form.enableDocker}
            onChange={(v) => setField("enableDocker", v)}
          />
        </SettingRow>
      </div>
    </SectionCard>
  );
}

export function HostFilesTab({
  form,
  setField,
}: {
  form: HostEditorForm;
  setField: SetHostField;
}) {
  const { t } = useTranslation();

  return (
    <SectionCard
      title={t("hosts.fileManager")}
      icon={<FolderSearch className="size-3.5" />}
    >
      <div className="flex flex-col gap-4 py-3">
        <SettingRow
          label={t("hosts.enableFileManagerMonitor")}
          description={t("hosts.enableFileManagerMonitorDesc")}
        >
          <FakeSwitch
            checked={form.enableFileManager}
            onChange={(v) => setField("enableFileManager", v)}
          />
        </SettingRow>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("hosts.defaultPathLabel")}
          </label>
          <Input
            placeholder="/"
            value={form.defaultPath}
            onChange={(e) => setField("defaultPath", e.target.value)}
          />
          <span className="text-[10px] text-muted-foreground">
            {t("hosts.fileManagerPathHint")}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
