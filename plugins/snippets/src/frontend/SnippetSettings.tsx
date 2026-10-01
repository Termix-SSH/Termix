import {
  useTranslation,
  type SettingsState,
} from "@termix/plugin-sdk/frontend";
import { ArrowLeft, Rows3, SquareStack } from "lucide-react";
import { FakeSwitch, SectionCard, SettingRow } from "@termix/plugin-sdk/ui";
import { readSnippetSettings, type SnippetDisplaySettings } from "./settings";

export function SnippetSettings({
  settings,
  onBack,
}: {
  settings: SettingsState;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const current = readSnippetSettings(settings.values);

  const save = (patch: Partial<SnippetDisplaySettings>) =>
    void settings.save({ ...settings.values, ...patch });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <button
        onClick={onBack}
        className="flex items-center gap-2 px-3 py-2 shrink-0 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors border-b border-border"
      >
        <ArrowLeft className="size-3.5 shrink-0" />
        <span>{t("backToSnippets")}</span>
        <span className="ml-auto font-semibold text-foreground">
          {t("settingsTitle")}
        </span>
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        <SectionCard
          title={t("settingsDisplayTitle")}
          icon={<Rows3 className="size-3.5" />}
        >
          <SettingRow
            label={t("settings.foldersCollapsed.label")}
            description={t("settings.foldersCollapsed.description")}
          >
            <FakeSwitch
              checked={current.foldersCollapsed}
              onChange={(v) => save({ foldersCollapsed: v })}
            />
          </SettingRow>
          <SettingRow
            label={t("settings.showCommands.label")}
            description={t("settings.showCommands.description")}
          >
            <FakeSwitch
              checked={current.showCommands}
              onChange={(v) => save({ showCommands: v })}
            />
          </SettingRow>
        </SectionCard>

        <SectionCard
          title={t("settingsBehaviorTitle")}
          icon={<SquareStack className="size-3.5" />}
        >
          <SettingRow
            label={t("settings.confirmExecution.label")}
            description={t("settings.confirmExecution.description")}
          >
            <FakeSwitch
              checked={current.confirmExecution}
              onChange={(v) => save({ confirmExecution: v })}
            />
          </SettingRow>
        </SectionCard>
      </div>
    </div>
  );
}
