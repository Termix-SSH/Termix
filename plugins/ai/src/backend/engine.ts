import { getErrorMessage } from "./errors.js";
import { describeProviderError } from "./providers/http.js";
import { getAdapter } from "./providers/registry.js";
import type {
  ChatMessage,
  ProviderConfig,
  ToolCall,
} from "./providers/types.js";
import { redact, redactToJson } from "./redaction.js";
import { toolDefinitions } from "./tools/catalog.js";
import {
  isProposalDraft,
  type AiTool,
  type ProposalDraft,
  type ToolContext,
} from "./tools/types.js";

/**
 * The agent loop: stream a turn, run any tools the model asked for, feed the
 * results back, repeat. Bounded so a model that keeps calling tools cannot spin
 * forever.
 */

const MAX_TURNS = 8;

export type EngineEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "proposal"; draft: ProposalDraft }
  /** A message added to the conversation, for the caller to store. */
  | { type: "message"; message: ChatMessage }
  | { type: "done" }
  | { type: "error"; message: string };

export interface EngineOptions {
  config: ProviderConfig;
  model: string;
  system: string;
  history: ChatMessage[];
  context: ToolContext;
  /** What the model may call this turn; availableTools() decides. */
  tools: AiTool[];
  signal?: AbortSignal;
}

export async function* runAgent(
  options: EngineOptions,
): AsyncGenerator<EngineEvent> {
  const adapter = getAdapter(options.config.providerType);
  const tools = toolDefinitions(options.tools);
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));
  const messages: ChatMessage[] = [...options.history];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    let text = "";
    const calls: ToolCall[] = [];
    let failed = false;

    try {
      for await (const chunk of adapter.streamChat(options.config, {
        model: options.model,
        system: options.system,
        messages,
        tools,
        signal: options.signal,
      })) {
        if (chunk.type === "text") {
          text += chunk.text;
          yield { type: "token", text: chunk.text };
        } else if (chunk.type === "tool_call") {
          calls.push(chunk.call);
        } else if (chunk.type === "error") {
          failed = true;
          yield { type: "error", message: chunk.message };
        }
      }
    } catch (error) {
      // The user stopped it; there is no one left to show an error to.
      if (options.signal?.aborted) return;
      const message = describeProviderError(
        error,
        "The provider request failed",
      );
      yield { type: "error", message };
      return;
    }

    if (failed) return;

    if (!calls.length) {
      yield { type: "message", message: { role: "assistant", content: text } };
      yield { type: "done" };
      return;
    }

    const assistant: ChatMessage = {
      role: "assistant",
      content: text,
      toolCalls: calls,
    };
    messages.push(assistant);
    yield { type: "message", message: assistant };

    for (const call of calls) {
      if (options.signal?.aborted) return;
      yield { type: "tool_call", name: call.name, arguments: call.arguments };

      const result = await runTool(byName, call, options.context);

      if (isProposalDraft(result)) {
        // Closes the tool call before the proposal card is emitted. Without
        // this the call has no matching result and renders as permanently
        // running, even though the work is done and awaiting the user.
        yield {
          type: "tool_result",
          name: call.name,
          result: { status: "awaiting_user_approval" },
        };
        yield { type: "proposal", draft: result };
        // The model is told the proposal is awaiting the user rather than done,
        // so it does not go on to describe the change as applied.
        const pending: ChatMessage = {
          role: "tool",
          content: JSON.stringify({
            status: "awaiting_user_approval",
            summary: result.summary,
          }),
          toolCallId: call.id,
          toolName: call.name,
        };
        messages.push(pending);
        yield { type: "message", message: pending };
        continue;
      }

      yield { type: "tool_result", name: call.name, result: redact(result) };
      const answer: ChatMessage = {
        role: "tool",
        content: redactToJson(result),
        toolCallId: call.id,
        toolName: call.name,
      };
      messages.push(answer);
      yield { type: "message", message: answer };
    }
  }

  // Ran out of turns with the model still calling tools.
  yield {
    type: "error",
    message: "The assistant used too many steps without finishing.",
  };
}

async function runTool(
  tools: Map<string, AiTool>,
  call: ToolCall,
  context: ToolContext,
): Promise<unknown> {
  const tool = tools.get(call.name);

  // A model can emit any name it likes; only what was offered runs.
  if (!tool) {
    return { error: `Unknown tool: ${call.name}` };
  }

  try {
    return await tool.handler(call.arguments ?? {}, context);
  } catch (error) {
    return {
      error: getErrorMessage(error, "The tool failed"),
    };
  }
}
