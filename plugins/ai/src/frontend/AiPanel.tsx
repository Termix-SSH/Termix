import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Loader2, Send, Settings2, Sparkles, Square } from "lucide-react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@termix/plugin-sdk/ui";
import {
  getAiProviders,
  getAiStatus,
  setAiOptIn,
  type AiProposal,
  type AiProvider,
} from "./ai-api";
import { AiMessage } from "./AiMessage";
import { AiProviderSettings } from "./AiProviderSettings";
import { AiToolCall } from "./AiToolCall";
import { ProposalCard } from "./ProposalCard";
import {
  buildTimeline,
  finishedRunEntries,
  userEntry,
  type HistoryEntry,
} from "./transcript";
import { useAiStream, type ToolActivity } from "./use-ai-stream";
import {
  activeMentionQuery,
  useMentions,
  type MentionItem,
} from "./useMentions";
import { mentionLabel } from "./labels";

export function AiPanel({ activeTab }: { activeTab?: string | null }) {
  const { t } = useTranslation();
  const { state, send, stop } = useAiStream();

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [resolvedProposals, setResolvedProposals] = useState<
    Record<number, { status: "applied" | "rejected"; resultSummary?: string }>
  >({});
  const runCountRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [mention, setMention] = useState<{
    query: string;
    start: number;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const { search: searchMentions } = useMentions(Boolean(providerId));

  const mentionMatches = mention ? searchMentions(mention.query) : [];

  const updateMentionQuery = (value: string, caret: number) => {
    const next = activeMentionQuery(value, caret);
    setMention(next);
    setMentionIndex(0);
  };

  /**
   * Replaces the "@partial" under the caret with the chosen name. The mention
   * is plain text: the assistant still has to call a read tool to look the
   * item up, so nothing is attached to the prompt behind the user's back.
   */
  const insertMention = (item: MentionItem) => {
    if (!mention) return;
    const caret = textareaRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, mention.start);
    const after = input.slice(caret);
    const inserted = `@${item.label} `;

    setInput(`${before}${inserted}${after}`);
    setMention(null);

    requestAnimationFrame(() => {
      const position = before.length + inserted.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    });
  };

  const loadProviders = useCallback(async (selectId?: number) => {
    try {
      const list = await getAiProviders();
      setProviders(list);
      setProviderId((current) => {
        // A provider that was just added becomes the active one, so there is
        // no second step between creating it and being able to use it.
        if (selectId && list.some((entry) => entry.id === selectId)) {
          return selectId;
        }
        // Fall back to the first if the current selection has gone away.
        if (current && list.some((entry) => entry.id === current)) {
          return current;
        }
        return list[0]?.id ?? null;
      });
      return list;
    } catch {
      setProviders([]);
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getAiStatus();
        if (cancelled) return;

        // Opening the panel is consent to use it. Without this every write
        // 403s through the gate, which surfaces as a bare permission error
        // rather than anything the user can act on.
        if (status.globallyEnabled && !status.enabled) {
          await setAiOptIn(true);
        }
        if (!status.globallyEnabled) return;

        const list = await loadProviders();
        // With nothing configured there is nothing to chat with, so go
        // straight to the form instead of showing a card that just vanishes.
        if (!cancelled && list.length === 0) setShowSettings(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProviders]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [state.assistantText, state.tools.length, history.length]);

  // The run's steps stay in the transcript, so the next message does not wipe
  // what the assistant already looked at.
  const keepRun = useCallback(
    (_conversationId: number | null, reply: string, tools: ToolActivity[]) => {
      const runId = runCountRef.current++;
      setHistory((prev) => [
        ...prev,
        ...finishedRunEntries(runId, tools, reply),
      ]);
    },
    [],
  );

  async function handleSend() {
    const message = input.trim();
    if (!message || !providerId || state.streaming) return;

    setInput("");
    setHistory((prev) => [...prev, userEntry(message)]);

    await send({
      message,
      providerId,
      conversationId: state.conversationId,
      activeTab,
      onComplete: keepRun,
    });
  }

  /**
   * Records the outcome on the card and tells the assistant what happened.
   *
   * Without the follow-up the run just stops: the assistant proposed a
   * command, the user approved it, and the model never learns it produced
   * output, so it sits there as if the tool were still running.
   */
  function handleProposalResolved(
    id: number,
    status: "applied" | "rejected",
    resultSummary?: string,
  ) {
    setResolvedProposals((prev) => ({
      ...prev,
      [id]: { status, resultSummary },
    }));

    if (!providerId || state.streaming) return;

    const proposal = state.proposals.find((entry) => entry.id === id);
    const label = proposal?.summary ?? proposal?.kind ?? `proposal ${id}`;

    const followUp =
      status === "applied"
        ? resultSummary
          ? `I approved "${label}". Result:\n\n${resultSummary}`
          : `I approved "${label}". It completed.`
        : `I rejected "${label}". Do not retry it unless I ask.`;

    setHistory((prev) => [...prev, userEntry(followUp)]);

    void send({
      message: followUp,
      providerId,
      conversationId: state.conversationId,
      activeTab,
      onComplete: keepRun,
    });
  }

  const proposals: AiProposal[] = state.proposals.map((proposal) => {
    const resolved = resolvedProposals[proposal.id];
    if (!resolved) return proposal;
    return {
      ...proposal,
      status: resolved.status,
      resultSummary: resolved.resultSummary ?? proposal.resultSummary,
    };
  });

  const timeline = buildTimeline(history, state, proposals);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={20} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/*
        The panel also lives in the narrow sidebar, so the title and the
        provider picker get their own rows rather than competing for one line.
      */}
      <div className="border-b border-border">
        <div className="flex items-center gap-2 px-3 py-2">
          <Sparkles size={16} className="shrink-0" />
          <span className="truncate text-sm font-medium">{t("ai.title")}</span>
          <a
            href="https://docs.termix.site/features/ai/overview"
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 text-[10px] text-accent-brand hover:underline"
          >
            {t("hosts.docsLink")}
          </a>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => setShowSettings((value) => !value)}
            aria-label={t("ai.providerSettings")}
          >
            <Settings2 size={14} />
          </Button>
        </div>

        {providers.length > 0 && (
          <div className="flex items-center gap-2 px-3 pb-2">
            <Select
              value={providerId ? String(providerId) : undefined}
              onValueChange={(value) => setProviderId(Number(value))}
            >
              <SelectTrigger className="h-7 min-w-0 flex-1 rounded-none text-xs">
                <SelectValue placeholder={t("ai.selectProvider")} />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={String(provider.id)}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {showSettings && (
        <div className="border-b border-border p-3">
          <AiProviderSettings
            providers={providers}
            onChanged={loadProviders}
            // Adding the first provider is the reason the form opened, so it
            // closes once that is done and the chat becomes usable.
            onAdded={() => setShowSettings(false)}
          />
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {timeline.map((item) => {
          if (item.kind === "message") {
            return (
              <AiMessage
                key={item.key}
                role={item.role}
                content={item.content}
              />
            );
          }
          if (item.kind === "tool") {
            return (
              <AiToolCall
                key={item.key}
                tool={item.tool}
                streaming={item.live && state.streaming}
              />
            );
          }
          return (
            <ProposalCard
              key={item.key}
              proposal={item.proposal}
              onResolved={handleProposalResolved}
            />
          );
        })}

        {state.error && (
          <div className="rounded-none border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </div>
        )}
      </div>

      <div className="relative border-t border-border p-3">
        {mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 z-10 max-h-56 overflow-y-auto border border-border bg-popover shadow-md">
            {mentionMatches.map((item, index) => (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs ${
                  index === mentionIndex ? "bg-muted" : ""
                }`}
                onMouseDown={(event) => {
                  // mousedown, so the textarea does not lose the caret first.
                  event.preventDefault();
                  insertMention(item);
                }}
              >
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                  {mentionLabel(item.kind)}
                </span>
                <span className="truncate font-medium">{item.label}</span>
                {item.detail && (
                  <span className="ml-auto shrink-0 truncate text-[10px] text-muted-foreground">
                    {item.detail}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <Textarea
          ref={textareaRef}
          className="min-h-[64px] resize-none rounded-none text-sm"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            updateMentionQuery(
              event.target.value,
              event.target.selectionStart ?? 0,
            );
          }}
          onKeyDown={(event) => {
            if (mentionMatches.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMentionIndex((i) => (i + 1) % mentionMatches.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex(
                  (i) =>
                    (i - 1 + mentionMatches.length) % mentionMatches.length,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertMention(mentionMatches[mentionIndex]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMention(null);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder={t("ai.inputPlaceholder")}
          disabled={!providerId}
        />
        {/*
          The hint gets its own line and wraps: sharing a row with the send
          button left it truncated to an ellipsis in the sidebar, where the
          panel is at its narrowest.
        */}
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {t("ai.attachHint")}
        </p>
        <div className="mt-1.5 flex items-center justify-end gap-2">
          {state.streaming ? (
            <Button size="sm" variant="outline" onClick={stop}>
              <Square size={14} />
              {t("ai.stop")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              disabled={!input.trim() || !providerId}
              onClick={() => void handleSend()}
            >
              <Send size={14} />
              {t("ai.send")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
