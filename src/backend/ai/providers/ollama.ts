import { assertOk, joinUrl, providerFetch, readJsonLines } from "./http.js";
import type {
  ChatChunk,
  ChatRequest,
  ProviderAdapter,
  ProviderConfig,
} from "./types.js";

export const OLLAMA_DEFAULT_BASE = "http://localhost:11434";

function baseFor(config: ProviderConfig): string {
  return config.baseUrl?.trim() || OLLAMA_DEFAULT_BASE;
}

function toOllamaMessages(request: ChatRequest): unknown[] {
  const messages: unknown[] = [{ role: "system", content: request.system }];

  for (const message of request.messages) {
    if (message.role === "tool") {
      messages.push({
        role: "tool",
        content: message.content,
        ...(message.toolName ? { tool_name: message.toolName } : {}),
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      messages.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      continue;
    }

    messages.push({ role: message.role, content: message.content });
  }

  return messages;
}

export const ollamaAdapter: ProviderAdapter = {
  async *streamChat(
    config: ProviderConfig,
    request: ChatRequest,
  ): AsyncIterable<ChatChunk> {
    const response = await providerFetch(joinUrl(baseFor(config), "api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        messages: toOllamaMessages(request),
        stream: true,
        ...(request.tools.length
          ? {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }
          : {}),
      }),
    });

    await assertOk(response, "Ollama");

    let index = 0;
    let stopReason: string | undefined;

    // Ollama streams newline-delimited JSON rather than SSE.
    for await (const frame of readJsonLines(response)) {
      const payload = frame as any;

      if (
        typeof payload.message?.content === "string" &&
        payload.message.content
      ) {
        yield { type: "text", text: payload.message.content };
      }

      for (const call of payload.message?.tool_calls ?? []) {
        const name = call.function?.name;
        if (!name) continue;
        const rawArgs = call.function?.arguments;
        // Ollama sends an object, but some builds send a JSON string.
        let args: Record<string, unknown> = {};
        if (rawArgs && typeof rawArgs === "object") {
          args = rawArgs as Record<string, unknown>;
        } else if (typeof rawArgs === "string" && rawArgs.trim()) {
          try {
            args = JSON.parse(rawArgs);
          } catch {
            args = {};
          }
        }
        yield {
          type: "tool_call",
          call: { id: `call_${name}_${index++}`, name, arguments: args },
        };
      }

      if (payload.done) {
        stopReason = payload.done_reason ?? "stop";
        break;
      }
    }

    yield { type: "done", stopReason };
  },

  async listModels(config: ProviderConfig): Promise<string[]> {
    const response = await providerFetch(joinUrl(baseFor(config), "api/tags"), {
      method: "GET",
    });
    await assertOk(response, "Ollama");

    const body: any = await response.json();
    return (body.models ?? [])
      .map((entry: any) => entry.name)
      .filter((name: unknown): name is string => typeof name === "string")
      .sort();
  },
};
