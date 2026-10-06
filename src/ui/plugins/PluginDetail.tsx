import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Database,
  Download,
  ExternalLink,
  Pin,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Facts, PANEL } from "@/components/panel-layout";
import { FakeSwitch, SectionCard } from "@/components/section-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import { getPluginData, type PluginDataSummary } from "@/api/plugins-api";
import { CapabilityRow, PluginIconBox } from "./plugin-bits";
import {
  describeContributions,
  formatBytes,
  orderByRisk,
  type PluginEntry,
} from "./plugin-model";
import type { PluginsManager } from "./use-plugins-manager";

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function PluginDetail({
  plugin,
  manager,
  onUninstalled,
}: {
  plugin: PluginEntry;
  manager: PluginsManager;
  onUninstalled: () => void;
}) {
  const { t } = useTranslation();
  const busy = manager.busy.has(plugin.id) || manager.busy.has("*");
  const locked = manager.managedByServer;
  const running = plugin.status === "running";
  const failed = plugin.status === "failed" || plugin.status === "blocked";
  const compatible = plugin.versions.filter((v) => v.compatible);
  const [picked, setPicked] = useState<string>(
    plugin.version ?? plugin.latestVersion ?? "",
  );

  useEffect(() => {
    setPicked(plugin.version ?? plugin.latestVersion ?? "");
  }, [plugin.version, plugin.latestVersion]);

  const contributions = describeContributions(plugin.contributes);

  return (
    <div
      className={`mx-auto flex w-full max-w-5xl flex-col ${PANEL.gap} ${PANEL.body}`}
    >
      <Card className="flex-row flex-wrap items-start gap-4 px-4 py-4">
        <PluginIconBox
          name={plugin.icon}
          size="lg"
          muted={plugin.installed && !running}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="text-lg font-bold tracking-tight">{plugin.name}</h1>
          <span className="text-xs leading-relaxed text-muted-foreground">
            {plugin.description}
          </span>
          <Facts className="text-[11px] text-muted-foreground/70">
            {plugin.author && <span>{plugin.author}</span>}
            {plugin.version ? (
              <span>v{plugin.version}</span>
            ) : (
              plugin.latestVersion && <span>v{plugin.latestVersion}</span>
            )}
            {plugin.category && <span>{plugin.category}</span>}
            {plugin.pinnedVersion && (
              <span>
                {t("plugins.manager.pinnedTo", {
                  version: plugin.pinnedVersion,
                })}
              </span>
            )}
          </Facts>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {plugin.installed &&
            plugin.updateAvailable &&
            !plugin.pinnedVersion && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand dark:border-accent-brand/40 dark:bg-transparent dark:hover:bg-accent-brand/10"
                disabled={busy || locked}
                onClick={() => void manager.requestUpdate(plugin)}
              >
                <Download className="size-3.5" />
                {t("plugins.manager.updateTo", {
                  version: plugin.latestVersion,
                })}
              </Button>
            )}
          {plugin.installed ? (
            <>
              {failed ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy || locked}
                  onClick={() => void manager.retry(plugin)}
                >
                  <RotateCcw className="size-3.5" />
                  {t("plugins.manager.restart")}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={busy || locked}
                onClick={() => void manager.toggle(plugin)}
              >
                {plugin.enabled
                  ? t("plugins.manager.disable")
                  : t("plugins.manager.enable")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                disabled={busy || locked}
                onClick={async () => {
                  if (await manager.uninstall(plugin)) onUninstalled();
                }}
              >
                <Trash2 className="size-3.5" />
                {t("plugins.manager.uninstall")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand dark:border-accent-brand/40 dark:bg-transparent dark:hover:bg-accent-brand/10"
              disabled={busy || locked || !plugin.latestVersion}
              onClick={() => manager.requestInstall(plugin)}
            >
              <Download className="size-3.5" />
              {t("plugins.manager.install")}
            </Button>
          )}
        </div>
      </Card>

      {plugin.installed && failed && plugin.lastError && (
        <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-destructive" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-medium">
              {plugin.status === "blocked"
                ? t("plugins.manager.status.blocked")
                : t("plugins.manager.status.failed")}
            </span>
            <span className="break-words font-mono text-[11px] leading-snug text-muted-foreground">
              {plugin.lastError}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
        <div className="flex flex-col gap-2 lg:col-span-2">
          <SectionCard title={t("plugins.manager.whatItCanDo")} icon={null}>
            <div className="divide-y divide-border">
              {orderByRisk(plugin.capabilities).map((capability) => (
                <CapabilityRow
                  key={capability}
                  capability={capability}
                  showId
                  className="px-4 py-2.5"
                />
              ))}
              {plugin.capabilities.length === 0 && (
                <div className="px-4 py-2.5 text-[11px] text-muted-foreground">
                  {t("plugins.manager.consent.none")}
                </div>
              )}
            </div>
          </SectionCard>

          {plugin.versions.length > 0 && (
            <SectionCard
              title={t("plugins.manager.versionHistory")}
              icon={null}
            >
              <div className="divide-y divide-border">
                {plugin.versions.map((v) => (
                  <div
                    key={v.version}
                    className="flex flex-col gap-0.5 px-4 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{v.version}</span>
                      {v.version === plugin.version && (
                        <span className="border border-accent-brand/40 bg-accent-brand/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-brand">
                          {t("plugins.manager.installedBadge")}
                        </span>
                      )}
                      {!v.compatible && (
                        <span className="border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
                          {t("plugins.manager.incompatible")}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {formatDate(v.publishedAt)}
                      </span>
                    </div>
                    {v.releaseNotesUrl && (
                      <a
                        href={v.releaseNotesUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="w-fit text-[11px] text-muted-foreground hover:text-accent-brand"
                      >
                        {t("plugins.manager.releaseNotes")}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {plugin.installed && (
            <DataCard
              plugin={plugin}
              disabled={busy || locked}
              onDelete={() => manager.removeData(plugin)}
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          {contributions.length > 0 && (
            <SectionCard title={t("plugins.manager.addsToTermix")} icon={null}>
              <div className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {contributions.map((c) => (
                    <span
                      key={c.kind}
                      className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {t(`plugins.manager.contributes.${c.kind}`, {
                        count: c.count,
                      })}
                    </span>
                  ))}
                </div>
                <span className="text-[11px] leading-snug text-muted-foreground/70">
                  {t("plugins.manager.addsToTermixHint")}
                </span>
              </div>
            </SectionCard>
          )}

          {plugin.inRegistry && compatible.length > 0 && (
            <SectionCard title={t("plugins.manager.version")} icon={null}>
              <div className="flex flex-col gap-2 px-4 py-3">
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {plugin.installed
                    ? t("plugins.manager.versionPickHintInstalled")
                    : t("plugins.manager.versionPickHint")}
                </span>
                <div className="flex items-center gap-2">
                  <Select value={picked} onValueChange={setPicked}>
                    <SelectTrigger size="sm" className="flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {compatible.map((v) => (
                        <SelectItem
                          key={v.version}
                          value={v.version}
                          className="text-xs"
                        >
                          {v.version === plugin.latestVersion
                            ? t("plugins.manager.latestVersion", {
                                version: v.version,
                              })
                            : v.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy || locked || !picked || picked === plugin.version
                    }
                    onClick={() =>
                      plugin.installed
                        ? void manager.requestUpdate(plugin, picked)
                        : manager.requestInstall(plugin, picked)
                    }
                  >
                    {plugin.installed
                      ? t("plugins.manager.switchVersion")
                      : t("plugins.manager.install")}
                  </Button>
                </div>
              </div>
            </SectionCard>
          )}

          {plugin.installed && (
            <SectionCard title={t("plugins.manager.updates")} icon={null}>
              <div className="divide-y divide-border">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-medium">
                      {t("plugins.manager.autoUpdate")}
                    </span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {t("plugins.manager.autoUpdateHint")}
                    </span>
                  </div>
                  <FakeSwitch
                    checked={plugin.autoUpdate}
                    disabled={busy || locked || !!plugin.pinnedVersion}
                    onChange={(v) =>
                      void manager.setOptions(plugin, { autoUpdate: v })
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      <Pin className="size-3 text-muted-foreground" />
                      {t("plugins.manager.pin")}
                    </span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {t("plugins.manager.pinHint", {
                        version: plugin.version,
                      })}
                    </span>
                  </div>
                  <FakeSwitch
                    checked={!!plugin.pinnedVersion}
                    disabled={busy || locked}
                    onChange={(v) =>
                      void manager.setOptions(plugin, { pinned: v })
                    }
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {plugin.repository && (
            <a
              href={plugin.repository}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 border border-border bg-card px-3 py-2.5 text-[11px] text-muted-foreground transition-colors hover:border-accent-brand/40 hover:text-foreground"
            >
              <ExternalLink className="size-3.5 shrink-0" />
              <span className="truncate">
                {plugin.repository.replace(/^https?:\/\//, "")}
              </span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function DataCard({
  plugin,
  disabled,
  onDelete,
}: {
  plugin: PluginEntry;
  disabled: boolean;
  onDelete: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<PluginDataSummary | null>(null);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    getPluginData(plugin.id)
      .then((summary) => {
        if (!cancelled) setData(summary);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [plugin.id, plugin.version, version]);

  const settings = data
    ? data.settings.admin + data.settings.user + data.settings.host
    : 0;
  const rows = data?.tables.reduce((sum, table) => sum + (table.rows ?? 0), 0);

  return (
    <SectionCard
      title={t("plugins.manager.data.title")}
      icon={<Database className="size-3.5" />}
      action={
        <Button
          variant="ghost"
          size="xs"
          className="gap-1 text-muted-foreground hover:text-destructive"
          disabled={disabled}
          onClick={async () => {
            if (await onDelete()) setVersion((v) => v + 1);
          }}
        >
          <Trash2 className="size-3" />
          {t("plugins.manager.data.delete")}
        </Button>
      }
    >
      {error ? (
        <div className="px-4 py-3 text-[11px] text-muted-foreground">
          {t("plugins.manager.data.loadFailed")}
        </div>
      ) : !data ? (
        <div className="px-4 py-3 text-[11px] text-muted-foreground">
          {t("plugins.manager.loading")}
        </div>
      ) : (
        <div className="-mx-3 -my-1 flex flex-col md:-mx-4">
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            <Stat
              label={t("plugins.manager.data.tables")}
              value={`${data.tables.length}`}
              hint={t("plugins.manager.data.rows", { count: rows ?? 0 })}
            />
            <Stat
              label={t("plugins.manager.data.kv")}
              value={`${data.kvKeys}`}
            />
            <Stat
              label={t("plugins.manager.data.settings")}
              value={`${settings}`}
              hint={t("plugins.manager.data.secrets", {
                count: data.settings.secret,
              })}
            />
            <Stat
              label={t("plugins.manager.data.files")}
              value={formatBytes(data.filesBytes)}
            />
          </div>
          {data.tables.length > 0 && (
            <div className="divide-y divide-border border-t border-border">
              {data.tables.map((table) => (
                <div
                  key={table.name}
                  className="flex items-center gap-2 px-4 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {table.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {table.rows === null
                      ? "-"
                      : t("plugins.manager.data.rows", { count: table.rows })}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span>
              {t("plugins.manager.data.migrations", {
                count: data.migrations.length,
              })}
            </span>
            <span>
              {t("plugins.manager.data.grants", { count: data.grants.length })}
            </span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-card px-4 py-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold">{value}</span>
      {hint && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}
