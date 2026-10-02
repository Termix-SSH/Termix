import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation, type TabProps } from "@termix/plugin-sdk/frontend";
import { Button, Input } from "@termix/plugin-sdk/ui";
import { Bot, Plus, Square, Play } from "lucide-react";
import { useAgentStream } from "./useAgentStream";
import { SessionTools } from "./SessionTools";
import { AgentComposer } from "./AgentComposer";
import { InstallRuntime } from "./InstallRuntime";
import { aiApp } from "../app-ref";
import { AiMessage } from "../AiMessage";
import { getAiProviders, type AiProvider } from "../ai-api";
import {
  AGENTS,
  compatible,
  type AgentEvent,
  type AgentKind,
  type AgentSession,
} from "../../backend/agents/types";

const names: Record<AgentKind, string> = {
  pi: "Pi",
  opencode: "OpenCode",
  claude: "Claude Code",
  codex: "Codex",
};
function message(error: unknown): string {
  const e = error as {
    response?: { data?: { error?: string } };
    message?: string;
  };
  return e.response?.data?.error || e.message || "Agent request failed";
}
export function AgentPanel({ host, sshHost }: TabProps) {
  const { t } = useTranslation();
  const target = host ?? sshHost;
  const hostId = Number(target?.id);
  const [providers, setProviders] = useState<AiProvider[]>([]),
    [sessions, setSessions] = useState<AgentSession[]>([]);
  const [agent, setAgent] = useState<AgentKind>("pi"),
    [providerId, setProviderId] = useState(0),
    [model, setModel] = useState("");
  const [cwd, setCwd] = useState("/tmp"),
    [executable, setExecutable] = useState("");
  const [active, setActive] = useState<AgentSession | null>(null),
    [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [answered, setAnswered] = useState<Set<string>>(new Set());
  const [generation, setGeneration] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([
      getAiProviders(),
      aiApp().api.get<{ sessions: AgentSession[] }>("/agents"),
    ]);
    setProviders(p.filter((x) => x.enabled));
    setSessions(s.data.sessions.filter((x) => x.hostId === hostId));
  }, [hostId]);
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, [refresh]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [events]);
  const activeId = active?.id;
  const connection = useAgentStream(
    activeId,
    generation,
    (s) => {
      setActive((old) => (old?.id === s.id ? s : old));
      setEvents((old) =>
        [
          ...s.events,
          ...old.filter((e) => e.seq > (s.events.at(-1)?.seq ?? 0)),
        ].slice(-2000),
      );
    },
    (e) => {
      setEvents((old) =>
        old.some((x) => x.seq === e.seq) ? old : [...old, e].slice(-2000),
      );
      if (e.kind === "status")
        setActive((old) =>
          old ? { ...old, status: e.text as AgentSession["status"] } : old,
        );
      if (e.kind === "error") setError(e.text);
    },
  );
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function select(id: string) {
    await action(async () => {
      const r = await aiApp().api.get<AgentSession>(`/agents/${id}`);
      setActive(r.data);
      setEvents(r.data.events);
      setAnswered(new Set());
    });
  }
  async function input(body: unknown) {
    if (active) await aiApp().api.post(`/agents/${active.id}/input`, body);
  }
  const transcript: AgentEvent[] = [];
  for (const e of events) {
    const last = transcript.at(-1);
    if (e.kind === "text" && last?.kind === "text") last.text += e.text;
    else transcript.push({ ...e });
  }
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      onKeyDown={(e) => {
        if (
          e.key !== "Escape" ||
          e.defaultPrevented ||
          e.repeat ||
          e.nativeEvent.isComposing ||
          e.nativeEvent.keyCode === 229 ||
          composing.current ||
          busy ||
          active?.status !== "running"
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        void action(() => input({ type: "cancel" }));
      }}
    >
      <header className="flex items-center gap-2 border-b p-3">
        <Bot size={18} />
        <strong>{t("agents.title")}</strong>
        <span className="text-muted-foreground">
          {String(target?.name ?? target?.ip ?? "")}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => {
            setActive(null);
            setEvents([]);
            void refresh();
          }}
        >
          <Plus size={14} />
          {t("agents.new")}
        </Button>
      </header>
      {error && (
        <div
          role="alert"
          className="m-3 whitespace-pre-wrap border border-destructive p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="max-h-40 overflow-auto border-b p-2 md:max-h-none md:w-56 md:border-r">
          <Input
            aria-label={t("agents.search")}
            placeholder={t("agents.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="my-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t("agents.showArchived")}
          </label>
          {sessions
            .filter(
              (s) =>
                !!s.archived === showArchived &&
                [s.title, s.model, s.cwd]
                  .join(" ")
                  .toLowerCase()
                  .includes(search.toLowerCase()),
            )
            .map((s) => (
              <button
                key={s.id}
                className={`mb-1 block w-full rounded p-2 text-left text-sm hover:bg-muted ${active?.id === s.id ? "bg-muted" : ""}`}
                onClick={() => void select(s.id)}
              >
                <div>{s.title || `${names[s.agent]} · ${s.model}`}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {s.cwd}
                </div>
              </button>
            ))}
          {!sessions.length && (
            <p className="p-2 text-sm text-muted-foreground">
              {t("agents.noSessions")}
            </p>
          )}
        </aside>
        {!active ? (
          <form
            className="mx-auto w-full max-w-xl space-y-4 overflow-auto p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const r = await aiApp().api.post<{ id: string }>("/agents", {
                  hostId,
                  agent,
                  providerId,
                  model,
                  cwd,
                  executable: executable || undefined,
                });
                const s = await aiApp().api.get<AgentSession>(
                  `/agents/${r.data.id}`,
                );
                setActive(s.data);
                setEvents(s.data.events);
                await refresh();
              });
            }}
          >
            <p className="text-sm text-muted-foreground">
              {t("agents.description")}
            </p>
            <label className="block space-y-1">
              <span>{t("agents.runtime")}</span>
              <select
                className="w-full rounded border bg-background p-2"
                value={agent}
                onChange={(e) => {
                  setAgent(e.target.value as AgentKind);
                  setProviderId(0);
                  setModel("");
                }}
              >
                {AGENTS.map((a) => (
                  <option key={a} value={a}>
                    {names[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span>{t("agents.provider")}</span>
              <select
                required
                className="w-full rounded border bg-background p-2"
                value={providerId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setProviderId(id);
                  setModel(
                    providers.find((p) => p.id === id)?.defaultModel ?? "",
                  );
                }}
              >
                <option value={0}>{t("agents.chooseProvider")}</option>
                {providers
                  .filter((p) => compatible(agent, p.providerType))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span>{t("agents.model")}</span>
              <Input
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span>{t("agents.directory")}</span>
              <Input
                required
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span>{t("agents.executable")}</span>
              <Input
                placeholder={agent}
                value={executable}
                onChange={(e) => setExecutable(e.target.value)}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {t("agents.requirements")}
            </p>
            {agent === "codex" && (
              <p className="text-sm">{t("agents.responsesRequired")}</p>
            )}
            {agent === "pi" && (
              <p className="text-sm">{t("agents.piPermissions")}</p>
            )}
            <InstallRuntime
              hostId={hostId}
              agent={agent}
              busy={busy}
              setBusy={setBusy}
            />
            <Button disabled={busy || !providerId || !model} type="submit">
              <Play size={14} />
              {t("agents.start")}
            </Button>
          </form>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col">
            {connection !== "connected" && (
              <p role="status" className="p-2 text-sm">
                {t(`agents.${connection}`)}
              </p>
            )}
            <SessionTools
              onWorktree={(path) => {
                setCwd(path);
                setAgent(active.agent);
                setProviderId(active.providerId);
                setModel(active.model);
                setExecutable(active.executable);
                setActive(null);
                setEvents([]);
              }}
              key={`tools-${active.id}`}
              session={active}
              busy={busy}
              action={action}
              onUpdated={async (s) => {
                setActive(s);
                await refresh();
              }}
            />
            <div className="flex flex-wrap items-center gap-2 border-b p-2 text-sm">
              <span>
                {names[active.agent]} · {active.model} · {active.cwd} ·{" "}
                {t(`agents.status.${active.status}`)}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || active.archived}
                onClick={() =>
                  void action(async () => {
                    await aiApp().api.post(`/agents/${active.id}/resume`);
                    setActive({ ...active, status: "starting" });
                    setGeneration((x) => x + 1);
                  })
                }
              >
                {t("agents.resume")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void action(async () => {
                    await aiApp().api.post(`/agents/${active.id}/stop`);
                    setActive({ ...active, status: "stopped" });
                    await refresh();
                  })
                }
              >
                <Square size={12} />
                {t("agents.stop")}
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {transcript
                .filter((e) => e.kind !== "state")
                .map((e) => (
                  <div key={e.seq}>
                    {e.kind === "text" || e.kind === "user" ? (
                      <AiMessage
                        role={e.kind === "user" ? "user" : "assistant"}
                        content={e.text}
                      />
                    ) : e.kind === "permission" ? (
                      <div className="space-y-2 rounded border p-3">
                        <strong>{t("agents.approval")}</strong>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                          {e.text}
                        </pre>
                        {e.choices?.length ? (
                          <select
                            className="w-full border bg-background p-2"
                            value={answers[e.requestId!] ?? ""}
                            onChange={(v) =>
                              setAnswers((a) => ({
                                ...a,
                                [e.requestId!]: v.target.value,
                              }))
                            }
                          >
                            <option value="">{t("agents.answer")}</option>
                            {e.choices.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            placeholder={t("agents.answer")}
                            value={answers[e.requestId!] ?? ""}
                            onChange={(v) =>
                              setAnswers((a) => ({
                                ...a,
                                [e.requestId!]: v.target.value,
                              }))
                            }
                          />
                        )}
                        {[true, false].map((allow) => (
                          <Button
                            key={String(allow)}
                            size="sm"
                            variant={allow ? "default" : "outline"}
                            disabled={answered.has(e.requestId!)}
                            onClick={() =>
                              void action(async () => {
                                await input({
                                  type: "answer",
                                  requestId: e.requestId,
                                  allow,
                                  value: answers[e.requestId!],
                                });
                                setAnswered(
                                  (a) => new Set([...a, e.requestId!]),
                                );
                              })
                            }
                          >
                            {t(allow ? "agents.allow" : "agents.deny")}
                          </Button>
                        ))}
                      </div>
                    ) : e.kind === "tool" ? (
                      <details className="rounded border p-2 text-xs">
                        <summary className="cursor-pointer">
                          {t("agents.tool")}
                        </summary>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap">
                          {e.text}
                        </pre>
                      </details>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {e.kind === "status"
                          ? t(`agents.status.${e.text}`)
                          : e.text}
                      </p>
                    )}
                  </div>
                ))}
              <div ref={bottom} />
            </div>
            <AgentComposer
              key={`composer-${active.id}`}
              session={active}
              busy={busy}
              action={action}
              onComposition={(value) => {
                composing.current = value;
              }}
              onUpdated={setActive}
            />
          </section>
        )}
      </div>
    </div>
  );
}
