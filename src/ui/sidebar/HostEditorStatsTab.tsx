import { useTranslation } from "react-i18next";
import {
  Activity,
  LayoutDashboard,
  Plus,
  Server,
  Trash2,
  Zap,
} from "lucide-react";

import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import type { HostEditorForm } from "./HostEditorData";

type SetHostField = <K extends keyof HostEditorForm>(
  key: K,
  value: HostEditorForm[K],
) => void;

export function HostStatsTab({
  form,
  setField,
  snippets,
}: {
  form: HostEditorForm;
  setField: SetHostField;
  snippets: { id: number; name: string }[];
}) {
  const { t } = useTranslation();

  return (
    <>
      <SectionCard
        title={t("hosts.statusChecksLabel")}
        icon={<Activity className="size-3.5" />}
      >
        <div className="flex flex-col gap-0 py-1">
          <SettingRow
            label={t("hosts.enableStatusChecks")}
            description={t("hosts.enableStatusChecksDesc")}
          >
            <FakeSwitch
              checked={form.statsConfig.statusCheckEnabled}
              onChange={(v) =>
                setField("statsConfig", {
                  ...form.statsConfig,
                  statusCheckEnabled: v,
                })
              }
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.useGlobalInterval")}
            description={t("hosts.useGlobalIntervalDesc")}
          >
            <FakeSwitch
              checked={form.statsConfig.useGlobalStatusInterval}
              onChange={(v) =>
                setField("statsConfig", {
                  ...form.statsConfig,
                  useGlobalStatusInterval: v,
                })
              }
            />
          </SettingRow>
          {form.statsConfig.statusCheckEnabled &&
            !form.statsConfig.useGlobalStatusInterval && (
              <SettingRow
                label={t("hosts.checkIntervalS")}
                description={t("hosts.checkIntervalDesc")}
              >
                <Input
                  type="number"
                  value={form.statsConfig.statusCheckInterval}
                  onChange={(e) =>
                    setField("statsConfig", {
                      ...form.statsConfig,
                      statusCheckInterval: Number(e.target.value),
                    })
                  }
                  className="w-20 h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </SettingRow>
            )}
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.metricsCollectionLabel")}
        icon={<Server className="size-3.5" />}
      >
        <div className="flex flex-col gap-0 py-1">
          <SettingRow
            label={t("hosts.enableMetricsLabel")}
            description={t("hosts.enableMetricsDesc")}
          >
            <FakeSwitch
              checked={form.statsConfig.metricsEnabled}
              onChange={(v) =>
                setField("statsConfig", {
                  ...form.statsConfig,
                  metricsEnabled: v,
                })
              }
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.useGlobalMetrics")}
            description={t("hosts.useGlobalMetricsDesc")}
          >
            <FakeSwitch
              checked={form.statsConfig.useGlobalMetricsInterval}
              onChange={(v) =>
                setField("statsConfig", {
                  ...form.statsConfig,
                  useGlobalMetricsInterval: v,
                })
              }
            />
          </SettingRow>
          {form.statsConfig.metricsEnabled &&
            !form.statsConfig.useGlobalMetricsInterval && (
              <SettingRow
                label={t("hosts.metricsIntervalS")}
                description={t("hosts.metricsIntervalDesc2")}
              >
                <Input
                  type="number"
                  value={form.statsConfig.metricsInterval}
                  onChange={(e) =>
                    setField("statsConfig", {
                      ...form.statsConfig,
                      metricsInterval: Number(e.target.value),
                    })
                  }
                  className="w-20 h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </SettingRow>
            )}
        </div>
      </SectionCard>
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
      <SectionCard
        title={t("hosts.quickActionsLabel")}
        icon={<Zap className="size-3.5" />}
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
            onClick={() =>
              setField("quickActions", [
                ...form.quickActions,
                { name: "", snippetId: "" },
              ])
            }
          >
            <Plus className="size-3 mr-1" /> {t("hosts.addActionBtn")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 py-3">
          <p className="text-xs text-muted-foreground">
            {t("hosts.quickActionsToolbar")}
          </p>
          {form.quickActions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-4 text-muted-foreground/40 gap-1.5">
              <Zap className="size-6" />
              <span className="text-xs">{t("hosts.noQuickActions")}</span>
            </div>
          )}
          {form.quickActions.map((a, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-2 bg-muted/20 border border-border group"
            >
              <Input
                className="h-7 text-xs flex-1"
                placeholder={t("hosts.buttonLabel")}
                value={a.name}
                onChange={(e) => {
                  const updated = [...form.quickActions];
                  updated[i] = { ...updated[i], name: e.target.value };
                  setField("quickActions", updated);
                }}
              />
              <select
                className="h-7 text-xs flex-1 border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
                value={a.snippetId}
                onChange={(e) => {
                  const updated = [...form.quickActions];
                  updated[i] = {
                    ...updated[i],
                    snippetId: e.target.value,
                  };
                  setField("quickActions", updated);
                }}
              >
                <option value="">{t("hosts.selectSnippetPlaceholder")}</option>
                {snippets.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() =>
                  setField(
                    "quickActions",
                    form.quickActions.filter((_, idx) => idx !== i),
                  )
                }
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  );
}
