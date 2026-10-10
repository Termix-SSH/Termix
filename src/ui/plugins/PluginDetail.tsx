import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Bug,
  Check,
  Database,
  Download,
  ExternalLink,
  FlaskConical,
  Lightbulb,
  Pin,
  RotateCcw,
  Settings,
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
import {
  BetaBadge,
  CapabilityRow,
  InstallCountFact,
  PluginIconBox,
  UnverifiedBadge,
} from "./plugin-bits";
import {
  betaFeedbackUrl,
  betaToTry,
  describeContributions,
  formatBytes,
  orderByRisk,
  reportIssueUrl,
  requestFeatureUrl,
  type PluginEntry,
} from "./plugin-model";
import { openPluginSettings } from "./open-plugins";
import { hasSettingsPage } from "@/settings/settings-fields-util";
import { PluginReleaseNotes, PluginVideo } from "./PluginReleaseNotes";
import type { PluginsManager } from "./use-plugins-manager";

const LINK_ROW =
  "flex items-center gap-2 border border-border bg-card px-3 py-2.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-accent-brand/40 hover:text-foreground";

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
  // Only people who can manage plugins get here, and they see admin settings
  const hasSettings =
    plugin.installed &&
    hasSettingsPage(plugin as Parameters<typeof hasSettingsPage>[0], true);
  const issueUrl = reportIssueUrl(
    plugin,
    import.meta.env.VITE_APP_VERSION || undefined,
  );
  const featureUrl = requestFeatureUrl(plugin);
  const feedbackUrl = plugin.isBeta
    ? betaFeedbackUrl(plugin, import.meta.env.VITE_APP_VERSION || undefined)
    : null;
  const tryableBeta = betaToTry(plugin);

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
            {plugin.unverified && <UnverifiedBadge />}
            {plugin.isBeta && <BetaBadge />}
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
            <InstallCountFact
              count={plugin.installCount}
              source={plugin.installCountSource}
            />
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
          {tryableBeta && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={busy || locked}
              onClick={() => void manager.tryBeta(plugin)}
            >
              <FlaskConical className="size-3.5" />
              {t("plugins.manager.beta.try", { version: tryableBeta })}
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
          <PluginVideo videoId={plugin.videoId} name={plugin.name} />

          {plugin.features.length > 0 && (
            <SectionCard title={t("plugins.manager.features")} icon={null}>
              <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-2">
                {plugin.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-xs leading-snug"
                  >
                    <Check className="mt-px size-3.5 shrink-0 text-accent-brand" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

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

          {plugin.env.length > 0 && (
            <SectionCard title={t("plugins.manager.envVars")} icon={null}>
              <div className="divide-y divide-border">
                {plugin.env.map((v) => (
                  <div
                    key={v.name}
                    className="flex flex-col gap-0.5 px-4 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-xs font-semibold">
                        {v.name}
                      </code>
                      {v.required && (
                        <span className="text-[9px] font-bold uppercase tracking-widest text-accent-brand">
                          {t("plugins.manager.envRequired")}
                        </span>
                      )}
                      {v.default !== undefined && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {t("plugins.manager.envDefault", {
                            value: v.default,
                          })}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {v.description}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          <PluginReleaseNotes plugin={plugin} />

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
                            : v.prerelease
                              ? t("plugins.manager.beta.versionLabel", {
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
                    className="h-8"
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
                      <FlaskConical className="size-3 text-muted-foreground" />
                      {t("plugins.manager.beta.channel")}
                    </span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {plugin.channel === "stable" && plugin.isBeta
                        ? t("plugins.manager.beta.waitingForStable", {
                            version: plugin.version,
                          })
                        : t("plugins.manager.beta.channelHint")}
                    </span>
                  </div>
                  <FakeSwitch
                    checked={plugin.channel === "beta"}
                    disabled={busy || locked}
                    onChange={(v) =>
                      void (v
                        ? manager.tryBeta(plugin)
                        : manager.leaveBeta(plugin))
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

          {plugin.docs && (
            <a
              href={plugin.docs}
              target="_blank"
              rel="noreferrer"
              className={LINK_ROW}
            >
              <BookOpen className="size-3.5 shrink-0" />
              <span className="truncate">
                {t("plugins.manager.documentation")}
              </span>
            </a>
          )}

          {hasSettings && (
            <button
              type="button"
              onClick={() => openPluginSettings(plugin.id)}
              className={LINK_ROW}
            >
              <Settings className="size-3.5 shrink-0" />
              <span className="truncate">
                {t("plugins.manager.openSettings")}
              </span>
            </button>
          )}

          {issueUrl && (
            <a
              href={issueUrl}
              target="_blank"
              rel="noreferrer"
              className={LINK_ROW}
            >
              <Bug className="size-3.5 shrink-0" />
              <span className="truncate">
                {plugin.source === "official" ||
                plugin.source === "bundled" ||
                !plugin.author
                  ? t("plugins.manager.reportIssue")
                  : t("plugins.manager.reportTo", { author: plugin.author })}
              </span>
            </a>
          )}

          {feedbackUrl && (
            <a
              href={feedbackUrl}
              target="_blank"
              rel="noreferrer"
              className={LINK_ROW}
            >
              <FlaskConical className="size-3.5 shrink-0" />
              <span className="truncate">
                {t("plugins.manager.beta.sendFeedback")}
              </span>
            </a>
          )}

          {featureUrl && (
            <a
              href={featureUrl}
              target="_blank"
              rel="noreferrer"
              className={LINK_ROW}
            >
              <Lightbulb className="size-3.5 shrink-0" />
              <span className="truncate">
                {t("plugins.manager.requestFeature")}
              </span>
            </a>
          )}

          {plugin.repository && (
            <a
              href={plugin.repository}
              target="_blank"
              rel="noreferrer"
              className={LINK_ROW}
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
