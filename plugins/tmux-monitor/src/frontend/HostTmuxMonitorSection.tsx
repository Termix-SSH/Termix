import { Layers } from "lucide-react";
import {
  useTranslation,
  type HostEditorSectionProps,
} from "@termix/plugin-sdk/frontend";
import { FakeSwitch, SectionCard, SettingRow } from "@termix/plugin-sdk/ui";

type PluginSettingsForm = Record<string, Record<string, unknown>>;

/**
 * The host editor's tmux monitor toggle. Writes into the form's
 * pluginSettings for this plugin, which the editor saves through the
 * plugin's host settings route after the host itself.
 */
export function HostTmuxMonitorSection({
  form,
  updateForm,
}: HostEditorSectionProps) {
  const { t } = useTranslation();

  const settings = ((form?.pluginSettings as PluginSettingsForm | undefined)?.[
    "tmux-monitor"
  ] ?? {}) as Record<string, unknown>;
  const enabled = settings.enableTmuxMonitor === true;

  const setEnabled = (value: boolean) =>
    updateForm((current) => {
      const all = (current.pluginSettings ?? {}) as PluginSettingsForm;
      return {
        ...current,
        pluginSettings: {
          ...all,
          "tmux-monitor": { ...all["tmux-monitor"], enableTmuxMonitor: value },
        },
      };
    });

  return (
    <SectionCard
      title={t("tmuxMonitor.title")}
      icon={<Layers className="size-3.5" />}
    >
      <div className="flex flex-col gap-4 py-3">
        <SettingRow
          label={t("hosts.enableTmuxMonitor")}
          description={
            <>
              {t("hosts.enableTmuxMonitorDesc")}{" "}
              <a
                href="https://docs.termix.site/features/terminal/tmux"
                target="_blank"
                rel="noreferrer"
                className="text-accent-brand hover:underline"
              >
                {t("hosts.docsLink")}
              </a>
            </>
          }
        >
          <FakeSwitch checked={enabled} onChange={setEnabled} />
        </SettingRow>
      </div>
    </SectionCard>
  );
}
