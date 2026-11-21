import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Copy, Download, ExternalLink, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { Checkbox } from "@/components/checkbox";
import { Textarea } from "@/components/textarea";
import { LoadingState } from "@/components/loading-state";
import { TabStrip } from "@/components/tab-strip";
import { FakeSwitch } from "@/components/section-card";
import {
  BackButton,
  GroupHeading,
  PANEL,
  PanelShell,
  RefreshButton,
  ToolbarSelect,
} from "@/components/panel-layout";
import { copyToClipboard } from "@/lib/clipboard";
import { docsUrl } from "@/lib/docs";
import {
  buildIssueUrl,
  CORE_REPO_URL,
  normalizeGitHubRepo,
} from "@/lib/issue-url";
import { getStoredAuth } from "@/auth/Auth";
import { appReadyPromise, getUserInfo } from "@/main-axios";
import { getPlugins } from "@/api/plugins-api";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import {
  getPluginStoreState,
  setPluginSummaries,
  usePluginStore,
} from "@/plugin-host/plugin-store";
import { DIAGNOSTICS_MENU_CLASS } from "./open-diagnostics";
import { isElectron } from "@/lib/electron";
import {
  ADMIN_PARTS,
  buildReport,
  collectReport,
  defaultReportOptions,
  issueSummary,
  REPORT_PARTS,
  reportFileName,
  type ReportContext,
  type ReportData,
  type ReportOptions,
  type ReportPart,
} from "./build-report";
import { ServerLogsView } from "./ServerLogsView";

const PREVIEW_CHARS = 200_000;
// Radix selects refuse an empty value.
const ALL_PLUGINS = "__all__";

async function loadContext(): Promise<ReportContext> {
  await appReadyPromise;
  if (!getStoredAuth()?.loggedIn && !isElectron()) {
    return { signedIn: false, isAdmin: false };
  }
  try {
    const info = await getUserInfo();
    // The ?diagnostics page starts no plugins, but the probes need the list.
    if (!getPluginStoreState().loaded) {
      setPluginSummaries(await getPlugins().catch(() => []));
    }
    const hosts = await getSSHHosts().catch(() => []);
    return {
      signedIn: true,
      isAdmin: !!info.is_admin,
      username: info.username,
      hosts: hosts.map(
        (host: { name?: string; ip?: string; username?: string }) => ({
          name: host.name,
          ip: host.ip,
          username: host.username,
        }),
      ),
    };
  } catch {
    return { signedIn: false, isAdmin: false };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DiagnosticsView({
  focusPluginId,
  onClose,
}: {
  focusPluginId?: string;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"report" | "logs">("report");
  const [context, setContext] = useState<ReportContext | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [options, setOptions] = useState<ReportOptions>(() =>
    defaultReportOptions(focusPluginId),
  );
  const { records } = usePluginStore();

  const collect = useCallback(async () => {
    setCollecting(true);
    try {
      const ctx = context ?? (await loadContext());
      setContext(ctx);
      setData(await collectReport(ctx, options.focusPluginId));
    } finally {
      setCollecting(false);
    }
  }, [context, options.focusPluginId]);

  useEffect(() => {
    void collect();
    // Collects once on open; Refresh collects again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typing in the description should not rebuild a big report each key.
  const deferred = useDeferredValue(options);
  const report = useMemo(
    () => (data ? buildReport(data, deferred) : null),
    [data, deferred],
  );

  const set = (patch: Partial<ReportOptions>) =>
    setOptions((current) => ({ ...current, ...patch }));
  const setPart = (part: ReportPart, on: boolean) =>
    setOptions((current) => ({
      ...current,
      parts: { ...current.parts, [part]: on },
    }));

  const pluginOptions = useMemo(
    () => [
      { value: ALL_PLUGINS, label: t("diagnostics.allPlugins") },
      ...[...records.values()]
        .map((r) => r.summary)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((summary) => ({ value: summary.id, label: summary.name })),
    ],
    [records, t],
  );

  const focusRepo = options.focusPluginId
    ? normalizeGitHubRepo(
        records.get(options.focusPluginId)?.summary.repository,
      )
    : null;

  const download = () => {
    if (!report || !data) return;
    const blob = new Blob([report.text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = reportFileName(data.madeAt);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast.success(t("diagnostics.downloaded"));
  };

  const copy = async () => {
    if (!report) return;
    if (await copyToClipboard(report.text))
      toast.success(t("diagnostics.copied"));
    else toast.error(t("diagnostics.copyFailed"));
  };

  const openIssue = () => {
    if (!report || !data) return;
    download();
    const url = buildIssueUrl(focusRepo ?? CORE_REPO_URL, {
      template: "bug_report.yml",
      fields: {
        "termix-version": data.version ?? undefined,
        environment: data.environment,
        "what-happened": options.description?.trim() || undefined,
        logs: issueSummary(report, data),
      },
    });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const isAdmin = !!context?.isAdmin;

  return (
    <PanelShell
      icon={<Stethoscope className="size-4" />}
      title={t("diagnostics.title")}
      status={report ? formatSize(report.bytes) : undefined}
      leading={onClose ? <BackButton onClick={onClose} /> : undefined}
      docs={docsUrl("diagnostics")}
      actions={
        tab === "report" ? (
          <RefreshButton onClick={() => void collect()} loading={collecting} />
        ) : undefined
      }
      tabs={
        isAdmin ? (
          <TabStrip
            tabs={[
              { id: "report", label: t("diagnostics.reportTab") },
              { id: "logs", label: t("diagnostics.logsTab") },
            ]}
            activeTab={tab}
            onTabChange={(id) => setTab(id as "report" | "logs")}
          />
        ) : undefined
      }
      scroll={tab === "report"}
      footer={
        tab === "report" ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="mr-auto truncate text-xs text-muted-foreground">
              {t("diagnostics.footerHint")}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copy()}
              disabled={!report}
            >
              <Copy />
              {t("diagnostics.copy")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openIssue}
              disabled={!report}
            >
              <ExternalLink />
              {t("diagnostics.openIssue")}
            </Button>
            <Button size="sm" onClick={download} disabled={!report}>
              <Download />
              {t("diagnostics.download")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {tab === "logs" && isAdmin ? (
        <ServerLogsView />
      ) : (
        <div className={`flex flex-col ${PANEL.body} gap-3`}>
          <p className="text-sm text-muted-foreground">
            {t("diagnostics.intro")}
          </p>
          {context && !context.isAdmin && (
            <p className="text-xs text-muted-foreground">
              {context.signedIn
                ? t("diagnostics.notAdmin")
                : t("diagnostics.signedOut")}
            </p>
          )}

          <GroupHeading title={t("diagnostics.whatHappened")} />
          <Textarea
            value={options.description}
            onChange={(event) => set({ description: event.target.value })}
            placeholder={t("diagnostics.whatHappenedHint")}
            rows={3}
          />

          <GroupHeading title={t("diagnostics.include")} />
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {REPORT_PARTS.map((part) => {
              const locked = ADMIN_PARTS.has(part) && !isAdmin;
              return (
                <label
                  key={part}
                  className="flex items-start gap-2 text-sm"
                  title={locked ? t("diagnostics.adminOnly") : undefined}
                >
                  <Checkbox
                    checked={options.parts[part] && !locked}
                    disabled={locked}
                    onCheckedChange={(on) => setPart(part, on === true)}
                    className="mt-0.5"
                  />
                  <span className={locked ? "opacity-60" : undefined}>
                    <span className="block font-medium">
                      {t(`diagnostics.parts.${part}`)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`diagnostics.partHints.${part}`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <GroupHeading title={t("diagnostics.privacy")} />
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block font-medium">
                  {t("diagnostics.mask")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("diagnostics.maskHint")}
                </span>
              </span>
              <FakeSwitch
                checked={options.mask}
                onChange={(on) => set({ mask: on })}
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block font-medium">
                  {t("diagnostics.domText")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("diagnostics.domTextHint")}
                </span>
              </span>
              <FakeSwitch
                checked={options.domText}
                onChange={(on) => set({ domText: on })}
              />
            </label>
            {isAdmin && (
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block font-medium">
                    {t("diagnostics.warnOnly")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("diagnostics.warnOnlyHint")}
                  </span>
                </span>
                <FakeSwitch
                  checked={options.logsWarnOnly}
                  onChange={(on) => set({ logsWarnOnly: on })}
                />
              </label>
            )}
            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="block font-medium">
                  {t("diagnostics.focus")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("diagnostics.focusHint")}
                </span>
              </span>
              <ToolbarSelect
                contentClassName={DIAGNOSTICS_MENU_CLASS}
                value={options.focusPluginId ?? ALL_PLUGINS}
                onChange={(value) =>
                  set({
                    focusPluginId: value === ALL_PLUGINS ? undefined : value,
                  })
                }
                options={pluginOptions}
                label={t("diagnostics.focus")}
              />
            </div>
          </div>

          {report && report.findings.length > 0 && (
            <>
              <GroupHeading title={t("diagnostics.findings")} />
              <ul className="flex flex-col gap-1 text-sm">
                {report.findings.map((finding, index) => (
                  <li
                    key={index}
                    className={
                      finding.level === "problem"
                        ? "text-destructive"
                        : finding.level === "warning"
                          ? "text-warning"
                          : "text-muted-foreground"
                    }
                  >
                    {finding.text}
                  </li>
                ))}
              </ul>
            </>
          )}

          <GroupHeading title={t("diagnostics.preview")} />
          {!report ? (
            <LoadingState className="h-40" />
          ) : (
            <>
              {report.cut && (
                <p className="text-xs text-muted-foreground">
                  {t("diagnostics.cut")}
                </p>
              )}
              <pre className="max-h-[50vh] overflow-auto border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all thin-scrollbar">
                {report.text.length > PREVIEW_CHARS
                  ? `${report.text.slice(0, PREVIEW_CHARS)}\n\n${t("diagnostics.previewCut")}`
                  : report.text}
              </pre>
            </>
          )}
        </div>
      )}
    </PanelShell>
  );
}
