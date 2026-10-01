import {
  Button,
  HostDefaultBadge,
  Input,
  SectionCard,
  SettingRow,
  FakeSwitch,
  useIsDefaultsEditor,
} from "@termix/plugin-sdk/ui";
import { useState } from "react";
import {
  useTranslation,
  type HostEditorSectionProps,
} from "@termix/plugin-sdk/frontend";
import { HardDrive, LayoutDashboard, Plus, Server, Trash2 } from "lucide-react";

import { readHostMetricsSettings } from "../shared/stats-widgets.js";

const PLUGIN_ID = "host-metrics";

type PluginSettingsBag = Record<string, Record<string, unknown>>;

/**
 * The Host Metrics section of the host editor. Its values are this plugin's
 * host settings, carried on form.pluginSettings and saved by the editor after
 * the host itself.
 */
export function HostStatsTab({ form, updateForm }: HostEditorSectionProps) {
  const { t } = useTranslation();
  const [newMount, setNewMount] = useState("");
  const [newMonitoredPath, setNewMonitoredPath] = useState("");
  const [newMonitoredLabel, setNewMonitoredLabel] = useState("");
  const bag = (form.pluginSettings as PluginSettingsBag | undefined)?.[
    PLUGIN_ID
  ];
  const settings = readHostMetricsSettings(bag);
  const { excludedMounts, monitoredMounts } = settings;
  const defaultsEditor = useIsDefaultsEditor();

  const patch = (values: Record<string, unknown>) =>
    updateForm((current) => {
      const all =
        (current.pluginSettings as PluginSettingsBag | undefined) ?? {};
      return {
        pluginSettings: {
          ...all,
          [PLUGIN_ID]: { ...(all[PLUGIN_ID] ?? {}), ...values },
        },
      };
    });

  const addExcludedMount = () => {
    const value = newMount.trim();
    if (!value || excludedMounts.includes(value)) {
      setNewMount("");
      return;
    }
    patch({ excludedMounts: [...excludedMounts, value] });
    setNewMount("");
  };

  const addMonitoredMount = () => {
    const path = newMonitoredPath.trim();
    if (!path || monitoredMounts.some((entry) => entry.path === path)) return;
    patch({
      monitoredMounts: [
        ...monitoredMounts,
        { path, label: newMonitoredLabel.trim() || undefined },
      ],
    });
    setNewMonitoredPath("");
    setNewMonitoredLabel("");
  };

  return (
    <>
      <SectionCard
        title={t("hosts.metricsCollectionLabel")}
        icon={<Server className="size-3.5" />}
      >
        <div className="flex flex-col gap-0 py-1">
          <SettingRow
            label={t("hosts.enableMetricsLabel")}
            description={t("hosts.enableMetricsDesc")}
            defaultKey="metricsEnabled"
          >
            <FakeSwitch
              checked={settings.metricsEnabled}
              onChange={(v) => patch({ metricsEnabled: v })}
            />
          </SettingRow>
          {settings.metricsEnabled && (
            <SettingRow
              label={t("hosts.useGlobalMetrics")}
              description={t("hosts.useGlobalMetricsDesc")}
              defaultKey="metricsInterval"
            >
              <FakeSwitch
                checked={settings.metricsInterval === null}
                onChange={(v) => patch({ metricsInterval: v ? null : 30 })}
              />
            </SettingRow>
          )}
          {settings.metricsEnabled && settings.metricsInterval !== null && (
            <SettingRow
              label={t("hosts.metricsIntervalS")}
              description={t("hosts.metricsIntervalDesc2")}
            >
              <Input
                type="number"
                value={settings.metricsInterval ?? 30}
                onChange={(e) =>
                  patch({ metricsInterval: Number(e.target.value) })
                }
                className="w-20 h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </SettingRow>
          )}
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.monitoredMountsLabel")}
        icon={<HardDrive className="size-3.5" />}
      >
        <div className="flex flex-col gap-3 py-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t("hosts.monitoredMountsDesc")}
            <HostDefaultBadge settingKey="monitoredMounts" />
          </p>
          <div className="grid grid-cols-[1fr_0.7fr_auto] gap-2">
            <Input
              className="h-7 text-xs"
              placeholder={t("hosts.monitoredMountPathPlaceholder")}
              value={newMonitoredPath}
              onChange={(e) => setNewMonitoredPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addMonitoredMount();
                }
              }}
            />
            <Input
              className="h-7 text-xs"
              placeholder={t("hosts.monitoredMountLabelPlaceholder")}
              value={newMonitoredLabel}
              onChange={(e) => setNewMonitoredLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addMonitoredMount();
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={addMonitoredMount}
            >
              <Plus className="mr-1 size-3" /> {t("hosts.addMonitoredMount")}
            </Button>
          </div>
          {monitoredMounts.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-2 border border-border bg-muted/20 p-2 group"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {entry.path}
              </span>
              {entry.label && (
                <span className="truncate text-xs text-muted-foreground">
                  {entry.label}
                </span>
              )}
              <button
                className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                onClick={() =>
                  patch({
                    monitoredMounts: monitoredMounts.filter(
                      (mount) => mount.path !== entry.path,
                    ),
                  })
                }
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.excludedMountsLabel")}
        icon={<HardDrive className="size-3.5" />}
      >
        <div className="flex flex-col gap-3 py-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t("hosts.excludedMountsDesc")}
            <HostDefaultBadge settingKey="excludedMounts" />
          </p>
          <div className="flex items-center gap-2">
            <Input
              className="h-7 text-xs flex-1"
              placeholder={t("hosts.excludedMountsPlaceholder")}
              value={newMount}
              onChange={(e) => setNewMount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addExcludedMount();
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
              onClick={addExcludedMount}
            >
              <Plus className="size-3 mr-1" /> {t("hosts.addExcludedMount")}
            </Button>
          </div>
          {excludedMounts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-4 text-muted-foreground/40 gap-1.5">
              <HardDrive className="size-6" />
              <span className="text-xs">{t("hosts.excludedMountsEmpty")}</span>
            </div>
          )}
          {excludedMounts.map((mount, i) => (
            <div
              key={`${mount}-${i}`}
              className="flex items-center gap-2 p-2 bg-muted/20 border border-border group"
            >
              <span className="text-xs flex-1 font-mono truncate">{mount}</span>
              <button
                className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() =>
                  patch({
                    excludedMounts: excludedMounts.filter(
                      (_, idx) => idx !== i,
                    ),
                  })
                }
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </SectionCard>
      {!defaultsEditor && (
        <SectionCard
          title={t("hosts.visibleWidgets")}
          icon={<LayoutDashboard className="size-3.5" />}
        >
          <div className="flex flex-col gap-2 py-3">
            <p className="text-xs text-muted-foreground">
              {t("hosts.widgetsMovedToHostMetrics")}
            </p>
          </div>
        </SectionCard>
      )}
    </>
  );
}
