import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  Input,
  SectionCard,
  SettingRow,
  FakeSwitch,
} from "@termix/plugin-sdk/ui";
import { FolderSearch } from "lucide-react";
import type { HostEditorForm } from "@/sidebar/HostEditorData";

type SetHostField = <K extends keyof HostEditorForm>(
  key: K,
  value: HostEditorForm[K],
) => void;

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
        <SettingRow
          label={t("hosts.scpLegacyLabel")}
          description={t("hosts.scpLegacyDesc")}
        >
          <FakeSwitch
            checked={form.scpLegacy}
            onChange={(v) => setField("scpLegacy", v)}
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
