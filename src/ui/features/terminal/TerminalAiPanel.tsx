import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Bot, GripVertical, Send, Square, X } from "lucide-react";
import { Button } from "@/components/button";
import { getAiProviders, type AiProposal, type AiProvider } from "@/api/ai-api";
import { AiMessage } from "@/features/ai/AiMessage";
import { AiToolCall } from "@/features/ai/AiToolCall";
import { useAiStream } from "@/features/ai/use-ai-stream";
import { TerminalProposalCard } from "./TerminalProposalCard";
import {
  clampToolbarPosition,
  persistAiPanelPosition,
  readStoredAiPanelPosition,
  type ToolbarPosition,
} from "./toolbar-geometry";

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

type TimelineItem =
  | {
      kind: "message";
      key: string;
      role: "user" | "assistant";
      content: string;
    }
  | {
      kind: "tool";
      key: string;
      tool: import("@/features/ai/use-ai-stream").ToolActivity;
    }
  | { kind: "proposal"; key: string; proposal: AiProposal };

interface TerminalAiPanelProps {
  hostLabel: string;
  hostId: number;
  activeTab?: string | null;
  onClose: () => void;
  onRunInTerminal: (command: string) => void;
}

/**
 * A slimmed-down version of AiPanel docked to a terminal tab. Same backend
 * (/ai/chat/stream, propose_run_command, ProposalCard) as the main assistant,
 * so it respects the same admin/user gates and never runs a command without
 * an explicit approve.
 */
export function TerminalAiPanel({
  hostLabel,
  hostId,
  activeTab,
  onClose,
  onRunInTerminal,
}: TerminalAiPanelProps) {
  const { t } = useTranslation();
  const { state, send, stop } = useAiStream();

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [resolvedProposals, setResolvedProposals] = useState<
    Record<number, { status: "applied" | "rejected"; resultSummary?: string }>
  >({});
  const conversationIdRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [position, setPosition] = useState<ToolbarPosition>(
    readStoredAiPanelPosition,
  );
  const positionRef = useRef(position);
  positionRef.current = position;
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    basePosition: ToolbarPosition;
  } | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const host = panel?.offsetParent as HTMLElement | null;
    if (!panel || !host) return;
    const next = clampToolbarPosition(
      positionRef.current,
      panel.getBoundingClientRect(),
      host.getBoundingClientRect(),
      positionRef.current,
    );
    if (next.x !== positionRef.current.x || next.y !== positionRef.current.y) {
      positionRef.current = next;
      setPosition(next);
    }
    // Only re-clamp when the panel first mounts; drag handles the rest.
  }, []);

  const handleDragPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      basePosition: positionRef.current,
    };
  };
  const handleDragPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const panel = panelRef.current;
    const host = panel?.offsetParent as HTMLElement | null;
    if (!panel || !host) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const next = clampToolbarPosition(
      { x: drag.basePosition.x + deltaX, y: drag.basePosition.y + deltaY },
      panel.getBoundingClientRect(),
      host.getBoundingClientRect(),
      positionRef.current,
    );
    positionRef.current = next;
    setPosition(next);
  };
  const handleDragPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    persistAiPanelPosition(positionRef.current);
    dragRef.current = null;
    if (event.type !== "lostpointercapture") {
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      } catch {
        // The browser may have already released capture for this pointer.
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    getAiProviders()
      .then((list) => {
        if (cancelled) return;
        setProviders(list);
        setProviderId((current) => current ?? list[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state.assistantText, state.tools.length, history.length]);

  const handleResolved = useCallback(
    (id: number, status: "applied" | "rejected", resultSummary?: string) => {
      setResolvedProposals((current) => ({
        ...current,
        [id]: { status, resultSummary },
      }));
    },
    [],
  );

  const handleSend = useCallback(() => {
    const message = input.trim();
    if (!message || !providerId || state.streaming) return;

    setHistory((current) => [...current, { role: "user", content: message }]);
    setInput("");

    void send({
      message,
      providerId,
      conversationId: conversationIdRef.current,
      activeTab: activeTab ?? `terminal:${hostLabel}`,
      onComplete: (conversationId, reply) => {
        conversationIdRef.current = conversationId;
        if (reply) {
          setHistory((current) => [
            ...current,
            { role: "assistant", content: reply },
          ]);
        }
      },
    });
  }, [activeTab, hostLabel, input, providerId, send, state.streaming]);

  const proposals: AiProposal[] = state.proposals.map((proposal) => {
    const resolved = resolvedProposals[proposal.id];
    if (!resolved) return proposal;
    return {
      ...proposal,
      status: resolved.status,
      resultSummary: resolved.resultSummary ?? proposal.resultSummary,
    };
  });

  // The reply exists in two places once a turn finishes: the streamed text in
  // `state`, and the copy `onComplete` appended to `history`. Show it once,
  // and keep tool calls spliced in ahead of the reply they produced instead
  // of in a separate trailing block, so the timeline reads in the order
  // things actually happened rather than text-then-tools-then-proposals.
  const last = history[history.length - 1];
  const historyEndsWithThisReply =
    state.assistantText.length > 0 &&
    last?.role === "assistant" &&
    last.content === state.assistantText;
  const streamingReply = historyEndsWithThisReply ? "" : state.assistantText;
  const trailingReply = historyEndsWithThisReply ? history.length - 1 : -1;

  const timeline: TimelineItem[] = [];

  history.forEach((entry, index) => {
    if (index === trailingReply) return;
    timeline.push({
      kind: "message",
      key: `history-${index}`,
      role: entry.role,
      content: entry.content,
    });
  });

  for (const tool of state.tools) {
    timeline.push({ kind: "tool", key: tool.id, tool });
  }

  if (trailingReply >= 0) {
    timeline.push({
      kind: "message",
      key: `history-${trailingReply}`,
      role: "assistant",
      content: history[trailingReply].content,
    });
  } else if (streamingReply) {
    timeline.push({
      kind: "message",
      key: "streaming",
      role: "assistant",
      content: streamingReply,
    });
  }

  for (const proposal of proposals) {
    timeline.push({
      kind: "proposal",
      key: `proposal-${proposal.id}`,
      proposal,
    });
  }

  return (
    <div
      ref={panelRef}
      className="absolute right-2 top-12 z-[120] flex max-h-[calc(100%-4rem)] w-[min(420px,calc(100vw-1rem))] flex-col border border-border bg-background shadow-xl"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 border-b border-border px-3 py-2 active:cursor-grabbing"
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerEnd}
        onPointerCancel={handleDragPointerEnd}
        onLostPointerCapture={handleDragPointerEnd}
      >
        <div className="flex min-w-0 items-center gap-2">
          <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
          <Bot className="size-4 shrink-0 text-accent-brand" />
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-foreground">
              {t("ai.assistant")}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {hostLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={stop}
            disabled={!state.streaming}
            title={t("ai.stop")}
          >
            <Square className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={onClose}
            title={t("common.close")}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
      >
        {timeline.length === 0 && !loading && (
          <div className="text-xs text-muted-foreground">
            {t("ai.terminalPanelEmpty")}
          </div>
        )}
        {!loading && providers.length === 0 && (
          <div className="border border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
            {t("ai.noProvidersConfigured")}
          </div>
        )}
        {state.error && (
          <div className="border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {state.error}
          </div>
        )}
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
                streaming={state.streaming}
              />
            );
          }
          return (
            <TerminalProposalCard
              key={item.key}
              proposal={item.proposal}
              hostId={hostId}
              onRunInTerminal={onRunInTerminal}
              onResolved={handleResolved}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          placeholder={t("ai.terminalPanelPlaceholder")}
          rows={3}
          className="min-h-20 resize-none border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          disabled={state.streaming || providers.length === 0}
        />
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5"
          disabled={state.streaming || !input.trim() || !providerId}
          onClick={handleSend}
        >
          <Send className="size-3.5" />
          {t("ai.send")}
        </Button>
      </div>
    </div>
  );
}
