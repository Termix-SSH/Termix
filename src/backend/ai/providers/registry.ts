import { anthropicAdapter } from "./anthropic.js";
import { geminiAdapter } from "./gemini.js";
import { ollamaAdapter } from "./ollama.js";
import { openAiAdapter } from "./openai.js";
import type { AiProviderType, ProviderAdapter } from "./types.js";
import { AiProviderError } from "./types.js";

/**
 * openai_compatible reuses the OpenAI adapter: OpenRouter, Groq, Mistral,
 * DeepSeek, together.ai, LM Studio and vLLM all speak the same wire format,
 * they differ only in base URL.
 */
const ADAPTERS: Record<AiProviderType, ProviderAdapter> = {
  ollama: ollamaAdapter,
  anthropic: anthropicAdapter,
  openai: openAiAdapter,
  gemini: geminiAdapter,
  openai_compatible: openAiAdapter,
};

export function getAdapter(providerType: string): ProviderAdapter {
  const adapter = ADAPTERS[providerType as AiProviderType];
  if (!adapter) {
    throw new AiProviderError(`Unknown provider type: ${providerType}`);
  }
  return adapter;
}

/** Provider types that cannot work without a base URL. */
export const REQUIRES_BASE_URL: AiProviderType[] = [
  "ollama",
  "openai_compatible",
];

/** Provider types that cannot work without an API key. */
export const REQUIRES_API_KEY: AiProviderType[] = [
  "anthropic",
  "openai",
  "gemini",
];

/**
 * Shown when a provider's model list cannot be fetched: no key entered yet,
 * the endpoint is unreachable, or the vendor has no list endpoint. Users can
 * always type a model id the list does not contain, so this is a starting
 * point rather than a restriction.
 */
export const FALLBACK_MODELS: Record<AiProviderType, string[]> = {
  ollama: [
    "llama3.2",
    "llama3.1",
    "qwen2.5-coder",
    "mistral",
    "phi4",
    "gemma2",
  ],
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  openai: ["gpt-5", "gpt-5-mini", "o4-mini", "gpt-4.1"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  openai_compatible: [],
};
