import Anthropic from "@anthropic-ai/sdk";
import { providerFetch } from "./http.js";
import type {
  ChatChunk,
  ChatRequest,
  ProviderAdapter,
  ProviderConfig,
} from "./types.js";
import { AiProviderError } from "./types.js";

/**
 * Model ids offered in the picker. Users can type any other id; this is a
 * convenience list, not a restriction.
 */
export const ANTHROPIC_MODELS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
];

function createClient(config: ProviderConfig): Anthropic {
  if (!config.apiKey) {
    throw new AiProviderError("This provider needs an API key");
  }
  return new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseUrl?.trim() ? { baseURL: config.baseUrl.trim() } : {}),
    // Routes the SDK's HTTP through the shared egress guard.
    fetch: providerFetch as unknown as typeof fetch,
  });
}

function toAnthropicMessages(request: ChatRequest): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const message of request.messages) {
    if (message.role === "tool") {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId ?? "",
            content: message.content,
          },
        ],
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.content)
        content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      messages.push({ role: "assistant", content });
      continue;
    }

    if (message.role === "system") continue;
    messages.push({ role: message.role, content: message.content });
  }

  return messages;
}

/**
 * The SDK throws its own typed errors rather than going through assertOk, so
 * they are translated here to match what every other provider reports.
 */
function translateSdkError(error: unknown): never {
  const status =
    typeof (error as { status?: unknown })?.status === "number"
      ? (error as { status: number }).status
      : undefined;
  const detail = error instanceof Error ? error.message : String(error);

  if (status === 429) {
    throw new AiProviderError(
      `Anthropic rate limit reached. Wait a moment and try again, or check your plan's quota. (${detail})`,
      429,
    );
  }
  if (status === 401 || status === 403) {
    throw new AiProviderError(
      `Anthropic rejected the API key. Check that it is correct and still active. (${detail})`,
      status,
    );
  }
  throw new AiProviderError(
    status ? `Anthropic request failed (${status}): ${detail}` : detail,
    status,
  );
}

export const anthropicAdapter: ProviderAdapter = {
  async *streamChat(
    config: ProviderConfig,
    request: ChatRequest,
  ): AsyncIterable<ChatChunk> {
    const client = createClient(config);

    const stream = client.messages.stream({
      model: request.model,
      max_tokens: 16000,
      system: request.system,
      messages: toAnthropicMessages(request),
      thinking: { type: "adaptive" },
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    let final: Anthropic.Message;
    try {
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text", text: event.delta.text };
        }
      }
      final = await stream.finalMessage();
    } catch (error) {
      translateSdkError(error);
    }

    for (const block of final.content) {
      if (block.type === "tool_use") {
        yield {
          type: "tool_call",
          call: {
            id: block.id,
            name: block.name,
            arguments: (block.input ?? {}) as Record<string, unknown>,
          },
        };
      }
    }

    yield { type: "done", stopReason: final.stop_reason ?? undefined };
  },

  async listModels(): Promise<string[]> {
    return [...ANTHROPIC_MODELS];
  },
};
