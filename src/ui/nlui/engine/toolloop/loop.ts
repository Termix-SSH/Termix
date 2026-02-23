import type { Message, Tool, EngineEvent, ConfirmFunc, Usage } from '../types';
import type { LLMClientInterface } from '../llm/client';
import { isDangerous } from './danger';
import { truncateMessages } from './truncate';

const MAX_ITERATIONS = 25;
const MAX_TOOL_RESULT_LENGTH = 4000;

export interface Executor {
  execute(toolName: string, argsJSON: string, authToken: string): Promise<string>;
}

export class ToolLoop {
  private client: LLMClientInterface;
  private executor: Executor;
  private confirm: ConfirmFunc | null = null;
  private maxCtxTokens = 0;

  constructor(client: LLMClientInterface, executor: Executor) {
    this.client = client;
    this.executor = executor;
  }

  setConfirm(fn: ConfirmFunc | null) { this.confirm = fn; }
  setMaxContextTokens(n: number) { this.maxCtxTokens = n; }

  async run(
    messages: Message[],
    tools: Tool[],
    authToken: string,
    onEvent: (event: EngineEvent) => void,
    signal?: AbortSignal,
  ): Promise<Message[]> {
    const totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      signal?.throwIfAborted();

      const truncated = truncateMessages(messages, this.maxCtxTokens);
      const { message: msg, usage } = await this.client.chatStreamWithTools(
        truncated, tools,
        (delta) => onEvent({ type: 'content_delta', data: { delta } }),
        signal,
      );

      if (usage) {
        totalUsage.prompt_tokens += usage.prompt_tokens;
        totalUsage.completion_tokens += usage.completion_tokens;
        totalUsage.total_tokens += usage.total_tokens;
      }

      messages = [...messages, msg];

      // No tool calls — final response
      if (!msg.tool_calls?.length) {
        onEvent({ type: 'content', data: { text: msg.content } });
        this.emitUsage(onEvent, totalUsage);
        return messages;
      }

      // Execute each tool call
      for (const tc of msg.tool_calls) {
        onEvent({ type: 'tool_call', data: { name: tc.function.name, arguments: tc.function.arguments } });

        // Confirmation gate
        if (this.confirm && isDangerous(tc.function.name, tc.function.arguments)) {
          const approved = await this.confirm(tc.function.name, tc.function.arguments);
          if (!approved) {
            const result = 'Operation cancelled by user';
            onEvent({ type: 'tool_result', data: { name: tc.function.name, result } });
            messages = [...messages, { role: 'tool', content: result, tool_call_id: tc.id }];
            continue;
          }
        }

        let result: string;
        try {
          result = await this.executor.execute(tc.function.name, tc.function.arguments, authToken);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        if (result.length > MAX_TOOL_RESULT_LENGTH) {
          result = result.slice(0, MAX_TOOL_RESULT_LENGTH) + '\n...(truncated)';
        }

        onEvent({ type: 'tool_result', data: { name: tc.function.name, result } });
        messages = [...messages, { role: 'tool', content: result, tool_call_id: tc.id }];
      }
    }

    this.emitUsage(onEvent, totalUsage);
    throw new Error(`Max iterations (${MAX_ITERATIONS}) reached`);
  }

  private emitUsage(onEvent: (event: EngineEvent) => void, usage: Usage) {
    if (usage.total_tokens > 0) {
      onEvent({ type: 'usage', data: usage });
    }
  }
}
