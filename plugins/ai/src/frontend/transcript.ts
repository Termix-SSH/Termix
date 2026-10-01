import type { AiProposal } from "./ai-api";
import type { StreamState, ToolActivity } from "./use-ai-stream";

/** A finished part of the conversation, kept after the stream resets. */
export type HistoryEntry =
  | { kind: "message"; role: "user" | "assistant"; content: string }
  | { kind: "tool"; tool: ToolActivity };

/** One entry in the rendered conversation, in the order it happened. */
export type TimelineItem =
  | {
      kind: "message";
      key: string;
      role: "user" | "assistant";
      content: string;
    }
  /** live is false for a past run's step, which can never still be running. */
  | { kind: "tool"; key: string; tool: ToolActivity; live: boolean }
  | { kind: "proposal"; key: string; proposal: AiProposal };

export function userEntry(content: string): HistoryEntry {
  return { kind: "message", role: "user", content };
}

/**
 * What a finished run leaves in the transcript: its tool steps, then its
 * reply. Tool ids are only unique within one run, so they get a run prefix.
 */
export function finishedRunEntries(
  runId: number,
  tools: ToolActivity[],
  reply: string,
): HistoryEntry[] {
  const entries: HistoryEntry[] = tools.map((tool) => ({
    kind: "tool",
    tool: { ...tool, id: `run-${runId}-${tool.id}` },
  }));
  if (reply)
    entries.push({ kind: "message", role: "assistant", content: reply });
  return entries;
}

/** Past runs, then the run in progress, then its proposals. */
export function buildTimeline(
  history: HistoryEntry[],
  state: Pick<StreamState, "tools" | "assistantText">,
  proposals: AiProposal[],
): TimelineItem[] {
  const timeline: TimelineItem[] = history.map((entry, index) =>
    entry.kind === "tool"
      ? { kind: "tool", key: entry.tool.id, tool: entry.tool, live: false }
      : {
          kind: "message",
          key: `history-${index}`,
          role: entry.role,
          content: entry.content,
        },
  );

  for (const tool of state.tools) {
    timeline.push({ kind: "tool", key: tool.id, tool, live: true });
  }

  if (state.assistantText) {
    timeline.push({
      kind: "message",
      key: "streaming",
      role: "assistant",
      content: state.assistantText,
    });
  }

  for (const proposal of proposals) {
    timeline.push({
      kind: "proposal",
      key: `proposal-${proposal.id}`,
      proposal,
    });
  }

  return timeline;
}
