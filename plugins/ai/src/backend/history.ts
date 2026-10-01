import type { ChatMessage, ToolCall } from "./providers/types.js";

export interface StoredMessage {
  role: string;
  content: string;
  toolCalls: string | null;
}

const INTERRUPTED_RESULT = JSON.stringify({
  error: "No result: the reply was interrupted before this tool finished.",
});

function parseCalls(raw: string | null): ToolCall[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** A tool row keeps the call it answers in toolCalls, as a one-item list. */
export function toStoredMessage(message: ChatMessage): StoredMessage {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      toolCalls: JSON.stringify([
        { id: message.toolCallId, name: message.toolName },
      ]),
    };
  }
  return {
    role: message.role,
    content: message.content,
    toolCalls: message.toolCalls?.length
      ? JSON.stringify(message.toolCalls)
      : null,
  };
}

/**
 * Rebuilds what the provider sees from the stored rows.
 *
 * Every provider rejects an assistant turn whose tool calls have no results,
 * which is what a run cut off mid-way leaves behind, so any missing result is
 * filled in as interrupted. Tool rows that answer nothing are dropped.
 */
export function toChatHistory(rows: StoredMessage[]): ChatMessage[] {
  const history: ChatMessage[] = [];
  let open: ToolCall[] = [];

  const closeOpen = () => {
    for (const call of open) {
      history.push({
        role: "tool",
        content: INTERRUPTED_RESULT,
        toolCallId: call.id,
        toolName: call.name,
      });
    }
    open = [];
  };

  for (const row of rows) {
    if (row.role === "tool") {
      const answered = parseCalls(row.toolCalls)[0];
      const index = open.findIndex((call) => call.id === answered?.id);
      if (index === -1) continue;
      const [call] = open.splice(index, 1);
      history.push({
        role: "tool",
        content: row.content,
        toolCallId: call.id,
        toolName: call.name,
      });
      continue;
    }

    closeOpen();

    if (row.role === "assistant") {
      const calls = parseCalls(row.toolCalls);
      history.push({
        role: "assistant",
        content: row.content,
        ...(calls.length ? { toolCalls: calls } : {}),
      });
      open = [...calls];
    } else if (row.role === "user") {
      history.push({ role: "user", content: row.content });
    }
  }

  closeOpen();
  return history;
}
