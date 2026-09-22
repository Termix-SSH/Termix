import { assertOk, providerFetch, readSseLines } from "./http.js";
import type {
  ChatChunk,
  ChatRequest,
  ProviderAdapter,
  ProviderConfig,
} from "./types.js";
import { AiProviderError } from "./types.js";

const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

function baseFor(config: ProviderConfig): string {
  return config.baseUrl?.trim() || GEMINI_DEFAULT_BASE;
}

/**
 * Gemini has no tool role: a tool result is a user-side functionResponse part,
 * and an assistant tool request is a model-side functionCall part.
 */
function toGeminiContents(request: ChatRequest): unknown[] {
  const contents: unknown[] = [];

  for (const message of request.messages) {
    if (message.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.toolName ?? "tool",
              response: { result: message.content },
            },
          },
        ],
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const parts: unknown[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls) {
        // thoughtSignature must be returned exactly as received or Gemini
        // 2.5+ rejects the turn with a 400.
        parts.push({
          functionCall: { name: call.name, args: call.arguments },
          ...(call.providerSignature
            ? { thoughtSignature: call.providerSignature }
            : {}),
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    if (message.role === "system") continue;

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    });
  }

  return contents;
}

/**
 * Gemini rejects the JSON Schema keywords it does not implement, so the tool
 * schemas are trimmed to the subset it accepts.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);

  const source = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (key === "additionalProperties" || key === "$schema") continue;
    if (key === "properties" && value && typeof value === "object") {
      const properties: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(
        value as Record<string, unknown>,
      )) {
        properties[name] = toGeminiSchema(child);
      }
      output[key] = properties;
      continue;
    }
    output[key] = toGeminiSchema(value);
  }

  return output;
}

export const geminiAdapter: ProviderAdapter = {
  async *streamChat(
    config: ProviderConfig,
    request: ChatRequest,
  ): AsyncIterable<ChatChunk> {
    if (!config.apiKey) {
      throw new AiProviderError("This provider needs an API key");
    }

    const url = `${baseFor(config).replace(/\/+$/, "")}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;

    const response = await providerFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      signal: request.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: toGeminiContents(request),
        ...(request.tools.length
          ? {
              tools: [
                {
                  functionDeclarations: request.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: toGeminiSchema(tool.parameters),
                  })),
                },
              ],
            }
          : {}),
      }),
    });

    await assertOk(response, "Gemini");

    let index = 0;
    let stopReason: string | undefined;

    for await (const data of readSseLines(response)) {
      let frame: any;
      try {
        frame = JSON.parse(data);
      } catch {
        continue;
      }

      const candidate = frame.candidates?.[0];
      if (!candidate) continue;
      if (candidate.finishReason) stopReason = candidate.finishReason;

      for (const part of candidate.content?.parts ?? []) {
        if (typeof part.text === "string" && part.text) {
          yield { type: "text", text: part.text };
        }
        if (part.functionCall?.name) {
          yield {
            type: "tool_call",
            call: {
              id: `call_${part.functionCall.name}_${index++}`,
              name: part.functionCall.name,
              arguments: (part.functionCall.args ?? {}) as Record<
                string,
                unknown
              >,
              // Carried so the next turn can echo it back; without it Gemini
              // 400s as soon as a tool has been used once.
              providerSignature: part.thoughtSignature,
            },
          };
        }
      }
    }

    yield { type: "done", stopReason };
  },

  async listModels(config: ProviderConfig): Promise<string[]> {
    if (!config.apiKey) return [];

    const response = await providerFetch(
      `${baseFor(config).replace(/\/+$/, "")}/models`,
      { method: "GET", headers: { "x-goog-api-key": config.apiKey } },
    );
    await assertOk(response, "Gemini");

    const body: any = await response.json();
    return (body.models ?? [])
      .map((entry: any) => String(entry.name ?? "").replace(/^models\//, ""))
      .filter((name: string) => name.length > 0)
      .sort();
  },
};
