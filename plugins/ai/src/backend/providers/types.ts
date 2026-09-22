/**
 * The shape every provider adapter normalizes to. Adding a provider means
 * translating its wire format into these events; nothing downstream (the
 * engine, the tool dispatcher, the SSE route) knows which vendor is in use.
 */

export type AiProviderType =
  "ollama" | "anthropic" | "openai" | "gemini" | "openai_compatible";

export const AI_PROVIDER_TYPES: AiProviderType[] = [
  "ollama",
  "anthropic",
  "openai",
  "gemini",
  "openai_compatible",
];

export function isAiProviderType(value: unknown): value is AiProviderType {
  return (
    typeof value === "string" && (AI_PROVIDER_TYPES as string[]).includes(value)
  );
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Set on assistant turns that requested tools. */
  toolCalls?: ToolCall[];
  /** Set on tool turns, matching the id of the call being answered. */
  toolCallId?: string;
  toolName?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Opaque provider state that has to be echoed back verbatim on the next
   * turn. Gemini 2.5+ rejects a follow-up whose functionCall parts have lost
   * their thoughtSignature, so this rides along rather than being dropped.
   */
  providerSignature?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

export type ChatChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; stopReason?: string }
  | { type: "error"; message: string };

export interface ProviderConfig {
  providerType: AiProviderType;
  baseUrl?: string | null;
  apiKey?: string | null;
}

export interface ProviderAdapter {
  /** Streams a single assistant turn. Tool execution happens in the engine. */
  streamChat(
    config: ProviderConfig,
    request: ChatRequest,
  ): AsyncIterable<ChatChunk>;
  /** Model ids to offer in the picker, best effort. */
  listModels(config: ProviderConfig): Promise<string[]>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
