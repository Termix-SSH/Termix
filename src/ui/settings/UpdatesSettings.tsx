import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, ExternalLink, FlaskConical, Puzzle, Tag } from "lucide-react";
import { Button } from "@/components/button";
import { FakeSwitch, SectionCard, SettingRow } from "@/components/section-card";
import {
  getChannelReleases,
  getUpdateChannel,
  setUpdateChannel,
  type ReleaseInfo,
  type UpdateChannelState,
} from "@/api/system-status-api";
import {
  getPlugins,
  setAllPluginChannels,
  setPluginOptions,
  type PluginSummary,
} from "@/api/plugins-api";
import { reportBetaFeedbackUrl } from "@/lib/issue-url";
import { isElectron } from "@/lib/electron";
import { isPrerelease } from "@/plugins/plugin-model";
import { OPEN_PLUGINS_EVENT } from "@/plugins/open-plugins";
import { docsUrl } from "@/lib/docs";

const DOCKER_BETA_IMAGE = "ghcr.io/termix-ssh/termix:beta";

function onBeta(plugin: PluginSummary): boolean {
  return plugin.channel === "beta" || isPrerelease(plugin.version);
}

function ReleaseRow({
  label,
  release,
}: {
  label: string;
  release: ReleaseInfo | null;
}) {
  const { t } = useTranslation();
  return (
    <SettingRow
      label={label}
      description={
        release
          ? new Date(release.publishedAt).toLocaleDateString()
          : t("settings.updates.noRelease")
      }
    >
      {release && (
        <a
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs font-medium text-accent-brand hover:underline"
        >
          v{release.version}
          <ExternalLink className="size-3" />
        </a>
      )}
    </SettingRow>
  );
}

export function UpdatesSettings() {
  const { t } = useTranslation();
  const [channel, setChannel] = useState<UpdateChannelState | null>(null);
  const [releases, setReleases] = useState<{
    stable: ReleaseInfo | null;
    beta: ReleaseInfo | null;
  } | null>(null);
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const version = import.meta.env.VITE_APP_VERSION || undefined;

  const loadPlugins = useCallback(async () => {
    try {
      setPlugins(await getPlugins());
    } catch {
      setPlugins([]);
    }
  }, []);

  useEffect(() => {
    getUpdateChannel()
      .then(setChannel)
      .catch(() => setChannel(null));
    getChannelReleases()
      .then(setReleases)
      .catch(() => setReleases({ stable: null, beta: null }));
    void loadPlugins();
  }, [loadPlugins]);

  const betaPlugins = plugins.filter(onBeta);
  const runningBetas = plugins
    .filter((plugin) => isPrerelease(plugin.version))
    .map((plugin) => ({ id: plugin.id, version: plugin.version }));
  const joined = channel?.channel === "beta";

  const changeChannel = async (next: boolean) => {
    setBusy(true);
    try {
      setChannel(await setUpdateChannel(next ? "beta" : "stable"));
    } catch {
      toast.error(t("settings.updates.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const changePlugins = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      toast.error(t("settings.updates.saveFailed"));
    } finally {
      await loadPlugins();
      setBusy(false);
    }
  };

  const copyImage = async () => {
    try {
      await navigator.clipboard.writeText(DOCKER_BETA_IMAGE);
      toast.success(t("settings.updates.copied"));
    } catch {
      toast.error(t("settings.updates.copyFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <SectionCard
        title={t("settings.updates.betaProgram")}
        icon={<FlaskConical className="size-3.5" />}
        rowId="updates-beta"
      >
        <p className="py-3 text-xs leading-relaxed text-muted-foreground">
          {t("settings.updates.betaIntro")}
        </p>
        <SettingRow
          label={t("settings.updates.termixBetas")}
          description={
            channel?.runningBeta
              ? t("settings.updates.runningBetaBuild")
              : t("settings.updates.termixBetasHint")
          }
        >
          <FakeSwitch
            checked={joined}
            disabled={busy || !channel || channel.runningBeta}
            onChange={(next) => void changeChannel(next)}
          />
        </SettingRow>
        {joined && !channel?.runningBeta && (
          <div className="flex flex-col gap-2 py-3 text-xs">
            <span className="font-medium">
              {t("settings.updates.howToInstall")}
            </span>
            {isElectron() ? (
              <span className="text-muted-foreground">
                {t("settings.updates.desktopInstall")}{" "}
                {releases?.beta && (
                  <a
                    href={releases.beta.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-brand hover:underline"
                  >
                    {t("settings.updates.downloadBeta", {
                      version: releases.beta.version,
                    })}
                  </a>
                )}
              </span>
            ) : (
              <>
                <span className="text-muted-foreground">
                  {t("settings.updates.dockerInstall")}
                </span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px]">
                    {DOCKER_BETA_IMAGE}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5"
                    onClick={() => void copyImage()}
                  >
                    <Copy className="size-3.5" />
                    {t("settings.updates.copy")}
                  </Button>
                </div>
              </>
            )}
            <a
              href={docsUrl("betas")}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-accent-brand hover:underline"
            >
              {t("settings.updates.learnMore")}
              <ExternalLink className="size-3" />
            </a>
          </div>
        )}
        <SettingRow
          label={t("settings.updates.feedback")}
          description={t("settings.updates.feedbackHint")}
        >
          <Button size="sm" variant="outline" className="h-8 gap-1.5" asChild>
            <a
              href={reportBetaFeedbackUrl(version, runningBetas)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("settings.updates.sendFeedback")}
            </a>
          </Button>
        </SettingRow>
      </SectionCard>

      <SectionCard
        title={t("settings.updates.releases")}
        icon={<Tag className="size-3.5" />}
        rowId="updates-releases"
      >
        <SettingRow label={t("settings.updates.thisVersion")}>
          <span className="text-xs font-medium">
            {version ? `v${version}` : "-"}
          </span>
        </SettingRow>
        <ReleaseRow
          label={t("settings.updates.newestStable")}
          release={releases?.stable ?? null}
        />
        <ReleaseRow
          label={t("settings.updates.newestBeta")}
          release={releases?.beta ?? null}
        />
      </SectionCard>

      <SectionCard
        title={t("settings.updates.pluginBetas")}
        icon={<Puzzle className="size-3.5" />}
        rowId="updates-plugins"
      >
        <p className="py-3 text-xs leading-relaxed text-muted-foreground">
          {t("settings.updates.pluginBetasIntro")}{" "}
          <button
            type="button"
            className="text-accent-brand hover:underline"
            onClick={() =>
              window.dispatchEvent(new CustomEvent(OPEN_PLUGINS_EVENT))
            }
          >
            {t("settings.updates.openPlugins")}
          </button>
        </p>
        {betaPlugins.map((plugin) => (
          <SettingRow
            key={plugin.id}
            label={plugin.name}
            description={
              plugin.channel === "beta"
                ? `v${plugin.version}`
                : t("settings.updates.waitingForStable", {
                    version: plugin.version,
                  })
            }
          >
            {plugin.channel === "beta" && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busy}
                onClick={() =>
                  void changePlugins(() =>
                    setPluginOptions(plugin.id, { channel: "stable" }),
                  )
                }
              >
                {t("settings.updates.backToStable")}
              </Button>
            )}
          </SettingRow>
        ))}
        {plugins.length > 0 && (
          <div className="flex flex-wrap gap-2 py-3">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={busy}
              onClick={() =>
                void changePlugins(() => setAllPluginChannels("beta"))
              }
            >
              {t("settings.updates.allPluginsBeta")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={busy || betaPlugins.length === 0}
              onClick={() =>
                void changePlugins(() => setAllPluginChannels("stable"))
              }
            >
              {t("settings.updates.allPluginsStable")}
            </Button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
