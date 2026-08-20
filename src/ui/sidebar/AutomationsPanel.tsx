import { getErrorMessage } from "../lib/error-message.js";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  FlaskConical,
  Loader2,
  Play,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/button";
import { Badge } from "@/components/badge";
import {
  createAutomation,
  deleteAutomation,
  listAutomationRunSteps,
  listAutomationRuns,
  listAutomations,
  runAutomation,
  updateAutomation,
  type AutomationRow,
  type AutomationRunRow,
  type AutomationRunStepRow,
} from "@/api/automations-api";
import {
  deleteNotificationChannel,
  getNotificationChannels,
  testNotificationChannel,
  type NotificationChannel,
} from "@/api/alerts-api";
import { NotificationChannelDialog } from "./NotificationChannelDialog";
import { getSnippets } from "@/api/snippets-api";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import { listFleets } from "@/api/fleets-api";
import {
  AutomationEditor,
  emptyDraft,
  type AutomationDraft,
} from "./automations/AutomationEditor";
import {
  EMPTY_EDITOR_OPTIONS,
  type AutomationEditorOptions,
} from "./automations/editor-types";

type PanelTab = "automations" | "runs" | "channels";

const STATUS_CLASS: Record<string, string> = {
  success: "text-green-500",
  failed: "text-destructive",
  timeout: "text-destructive",
  running: "text-foreground",
  skipped: "text-muted-foreground",
  cancelled: "text-muted-foreground",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function AutomationsPanel({
  active = true,
  onEditingChange,
}: {
  active?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const base = "newUi.sidebar.automations";

  const [tab, setTab] = useState<PanelTab>("automations");
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [runs, setRuns] = useState<AutomationRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] =
    useState<AutomationEditorOptions>(EMPTY_EDITOR_OPTIONS);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<AutomationDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [webhookToken, setWebhookToken] = useState<string | null>(null);

  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [runSteps, setRunSteps] = useState<AutomationRunStepRow[]>([]);

  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] =
    useState<NotificationChannel | null>(null);

  const loadAutomations = useCallback(async () => {
    setLoading(true);
    try {
      setAutomations(await listAutomations());
    } catch {
      // A failed load leaves the previous list on screen.
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await listAutomationRuns({ limit: 100 }));
    } catch {
      // Non-fatal.
    }
  }, []);

  const loadOptions = useCallback(async () => {
    const [hosts, snippets, channelsResult, fleets] = await Promise.allSettled([
      getSSHHosts({ includeStatus: false }),
      getSnippets(),
      getNotificationChannels(),
      listFleets(),
    ]);

    if (channelsResult.status === "fulfilled") {
      setChannels(channelsResult.value);
    }

    setOptions({
      hosts:
        hosts.status === "fulfilled"
          ? hosts.value.map((host) => ({
              id: host.id,
              name: host.name || host.ip,
            }))
          : [],
      snippets:
        snippets.status === "fulfilled"
          ? snippets.value.map((s) => ({
              id: s.id,
              // SnippetRow only types its id; the rest is narrowed by callers.
              name: typeof s.name === "string" ? s.name : `#${s.id}`,
            }))
          : [],
      channels:
        channelsResult.status === "fulfilled"
          ? channelsResult.value.map((c) => ({ id: c.id, name: c.name }))
          : [],
      fleets:
        fleets.status === "fulfilled"
          ? fleets.value.map((f) => ({ id: f.id, name: f.name }))
          : [],
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadAutomations();
    void loadOptions();
  }, [active, loadAutomations, loadOptions]);

  useEffect(() => {
    if (active && tab === "runs") void loadRuns();
  }, [active, tab, loadRuns]);

  // Widens the sidebar while the editor is open, and releases it again on the
  // way out or when the user switches to another rail destination.
  useEffect(() => {
    if (active) onEditingChange?.(editorOpen);
  }, [active, editorOpen, onEditingChange]);

  useEffect(() => {
    return () => onEditingChange?.(false);
  }, [onEditingChange]);

  function closeEditor() {
    setWebhookToken(null);
    setEditorOpen(false);
  }

  function openCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setWebhookToken(null);
    setEditorOpen(true);
  }

  function openEdit(row: AutomationRow) {
    setEditingId(row.id);
    setDraft({
      name: row.name,
      description: row.description ?? "",
      enabled: !!row.enabled,
      concurrencyPolicy: row.concurrency_policy ?? "skip",
      definition: row.definition ?? emptyDraft().definition,
    });
    setWebhookToken(null);
    setEditorOpen(true);
  }

  async function save() {
    if (!draft.name.trim()) {
      toast.error(t(`${base}.nameRequired`));
      return;
    }

    setSaving(true);
    try {
      if (editingId === null) {
        const created = await createAutomation({
          name: draft.name.trim(),
          description: draft.description || null,
          enabled: draft.enabled,
          concurrencyPolicy: draft.concurrencyPolicy,
          definition: draft.definition,
        });
        toast.success(t(`${base}.created`));
        if (created.webhookToken) {
          setWebhookToken(created.webhookToken);
        } else {
          setEditorOpen(false);
        }
      } else {
        await updateAutomation(editingId, {
          name: draft.name.trim(),
          description: draft.description || null,
          enabled: draft.enabled,
          concurrencyPolicy: draft.concurrencyPolicy,
          definition: draft.definition,
        });
        toast.success(t(`${base}.updated`));
        setEditorOpen(false);
      }
      await loadAutomations();
    } catch (error) {
      toast.error(getErrorMessage(error, String(error)));
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: AutomationRow) {
    if (!confirm(t(`${base}.deleteConfirm`))) return;
    try {
      await deleteAutomation(row.id);
      toast.success(t(`${base}.deleted`));
      await loadAutomations();
    } catch (error) {
      toast.error(getErrorMessage(error, String(error)));
    }
  }

  async function run(row: AutomationRow, dryRun: boolean) {
    try {
      const outcome = await runAutomation(row.id, { dryRun });
      toast.success(t(`${base}.runFinished`, { status: outcome.status }));
      await loadAutomations();
      if (tab === "runs") await loadRuns();
    } catch (error) {
      toast.error(getErrorMessage(error, String(error)));
    }
  }

  async function testChannel(channel: NotificationChannel) {
    try {
      // Throws with the reason when delivery fails.
      await testNotificationChannel(channel.id);
      toast.success(t(`${base}.channelTestSent`));
    } catch (error) {
      toast.error(getErrorMessage(error, String(error)));
    }
  }

  async function removeChannel(channel: NotificationChannel) {
    if (!confirm(t(`${base}.deleteChannelConfirm`))) return;
    try {
      await deleteNotificationChannel(channel.id);
      toast.success(t(`${base}.channelDeleted`));
      await loadOptions();
    } catch (error) {
      toast.error(getErrorMessage(error, String(error)));
    }
  }

  async function toggleRun(runId: number) {
    if (expandedRun === runId) {
      setExpandedRun(null);
      return;
    }
    setExpandedRun(runId);
    try {
      setRunSteps(await listAutomationRunSteps(runId));
    } catch {
      setRunSteps([]);
    }
  }

  // Editing takes over the whole panel and widens the sidebar, the same way the
  // host manager does, rather than opening a dialog over the app.
  if (editorOpen) {
    const webhookUrl = webhookToken
      ? `${window.location.origin}/automations/webhook/${webhookToken}`
      : "";

    return (
      <div className="flex flex-col h-full min-h-0">
        <button
          onClick={closeEditor}
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors border-b border-border/50 shrink-0"
        >
          <ArrowLeft className="size-3.5 shrink-0" />
          <span>{t(`${base}.backToAutomations`)}</span>
          {editingId !== null && (
            <span
              className="ml-auto font-semibold text-foreground truncate max-w-[200px]"
              title={draft.name}
            >
              {draft.name}
            </span>
          )}
        </button>

        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {webhookToken ? (
            <div className="space-y-2">
              <p className="text-sm">{t(`${base}.webhookTokenTitle`)}</p>
              <p className="text-xs text-muted-foreground">
                {t(`${base}.webhookTokenDescription`)}
              </p>
              <div className="flex gap-2">
                <code className="flex-1 p-2 bg-muted text-xs break-all">
                  {webhookUrl}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-none border-border shrink-0"
                  onClick={() => {
                    navigator.clipboard?.writeText(webhookUrl);
                    toast.success(t(`${base}.copied`));
                  }}
                >
                  <Copy size={14} />
                </Button>
              </div>
            </div>
          ) : (
            <AutomationEditor
              draft={draft}
              options={options}
              onChange={setDraft}
            />
          )}
        </div>

        <div className="flex items-center gap-2 p-3 border-t border-border shrink-0">
          {webhookToken ? (
            <Button
              variant="outline"
              className="rounded-none ml-auto h-9 px-6 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={closeEditor}
            >
              {t("common.close")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="rounded-none border-border h-9 px-5"
                onClick={closeEditor}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="outline"
                className="rounded-none ml-auto h-9 px-6 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                disabled={saving}
                onClick={save}
              >
                {saving && (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                )}
                {t(`${base}.save`)}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 p-2 border-b border-border">
        {(["automations", "runs", "channels"] as PanelTab[]).map((key) => (
          <Button
            key={key}
            variant={tab === key ? "outline" : "ghost"}
            size="sm"
            className={`min-w-0 flex-shrink rounded-none h-7 px-2 text-xs ${
              tab === key
                ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand hover:bg-accent-brand/20 hover:text-accent-brand"
                : ""
            }`}
            onClick={() => setTab(key)}
          >
            <span className="truncate">
              {t(
                `${base}.${key === "automations" ? "tabAutomations" : key === "runs" ? "tabRuns" : "tabChannels"}`,
              )}
            </span>
          </Button>
        ))}
        <a
          href="https://docs.termix.site/features/automations/overview"
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 text-[10px] text-accent-brand hover:underline"
        >
          {t("hosts.docsLink")}
        </a>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === "automations" && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="rounded-none w-full mb-2 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={openCreate}
            >
              <Plus size={14} className="mr-1" />
              {t(`${base}.createAutomation`)}
            </Button>

            {loading && automations.length === 0 && (
              <div className="flex justify-center p-4">
                <Loader2 size={16} className="animate-spin" />
              </div>
            )}

            {!loading && automations.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">
                {t(`${base}.empty`)}
              </p>
            )}

            <div className="space-y-1">
              {automations.map((row) => (
                <div
                  key={row.id}
                  className="border border-border p-2.5 hover:bg-muted/40"
                >
                  <div className="flex items-center gap-2">
                    <Workflow size={14} className="shrink-0" />
                    <button
                      className="flex-1 text-left text-sm truncate"
                      onClick={() => openEdit(row)}
                    >
                      {row.name}
                    </button>
                    {!row.enabled && (
                      <Badge variant="outline" className="text-[10px]">
                        off
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[11px] text-muted-foreground flex-1 truncate">
                      {row.definition
                        ? t(
                            `${base}.triggerKinds.${row.definition.trigger.kind}`,
                          )
                        : ""}
                      {row.last_run_status
                        ? ` · ${timeAgo(row.last_run_at)}`
                        : ""}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-none"
                      title={t(`${base}.testRun`)}
                      onClick={() => run(row, true)}
                    >
                      <FlaskConical size={12} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-none"
                      title={t(`${base}.runNow`)}
                      onClick={() => run(row, false)}
                    >
                      <Play size={12} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-none"
                      onClick={() => remove(row)}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "runs" && (
          <div className="space-y-1">
            {runs.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">
                {t(`${base}.emptyRuns`)}
              </p>
            )}
            {runs.map((entry) => (
              <div key={entry.id} className="border border-border">
                <button
                  className="w-full text-left p-2.5 hover:bg-muted/40"
                  onClick={() => toggleRun(entry.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm flex-1 truncate">
                      {entry.automation_name ?? `#${entry.automation_id}`}
                    </span>
                    {entry.dry_run ? (
                      <Badge variant="outline" className="text-[10px]">
                        {t(`${base}.dryRunBadge`)}
                      </Badge>
                    ) : null}
                    <span
                      className={`text-[11px] ${STATUS_CLASS[entry.status] ?? ""}`}
                    >
                      {t(`${base}.statuses.${entry.status}`)}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {timeAgo(entry.started_at)}
                    {entry.duration_ms !== null
                      ? ` · ${Math.round(entry.duration_ms / 100) / 10}s`
                      : ""}
                  </div>
                  {entry.error && (
                    <div className="text-[11px] text-destructive truncate">
                      {entry.error}
                    </div>
                  )}
                </button>

                {expandedRun === entry.id && (
                  <div className="border-t border-border p-2 space-y-1">
                    {runSteps.map((step) => (
                      <div key={step.id} className="text-[11px]">
                        <div className="flex gap-2">
                          <span className="text-muted-foreground">
                            {step.step_index + 1}.
                          </span>
                          <span className="flex-1">
                            {t(`${base}.stepTypes.${step.step_type}`, {
                              defaultValue: step.step_type,
                            })}
                          </span>
                          <span className={STATUS_CLASS[step.status] ?? ""}>
                            {step.status}
                          </span>
                        </div>
                        {step.output && (
                          <pre className="mt-1 p-1 bg-muted overflow-x-auto whitespace-pre-wrap break-all text-[10px]">
                            {step.output}
                          </pre>
                        )}
                        {step.error && (
                          <div className="text-destructive">{step.error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "channels" && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="rounded-none w-full mb-2 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={() => {
                setEditingChannel(null);
                setChannelDialogOpen(true);
              }}
            >
              <Plus size={14} className="mr-1" />
              {t(`${base}.addChannel`)}
            </Button>

            {channels.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">
                {t(`${base}.emptyChannels`)}
              </p>
            )}

            <div className="space-y-1">
              {channels.map((channel) => (
                <div
                  key={channel.id}
                  className="border border-border p-2.5 hover:bg-muted/40"
                >
                  <div className="flex items-center gap-2">
                    <button
                      className="flex-1 text-left text-sm truncate"
                      onClick={() => {
                        setEditingChannel(channel);
                        setChannelDialogOpen(true);
                      }}
                    >
                      {channel.name}
                    </button>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {channel.type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 rounded-none text-[11px]"
                      onClick={() => testChannel(channel)}
                    >
                      {t(`${base}.testChannel`)}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-none"
                      onClick={() => removeChannel(channel)}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <NotificationChannelDialog
        open={channelDialogOpen}
        onOpenChange={setChannelDialogOpen}
        channel={editingChannel}
        onSaved={() => {
          setChannelDialogOpen(false);
          void loadOptions();
        }}
      />
    </div>
  );
}

export default AutomationsPanel;
