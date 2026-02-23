import type { Message, Tool, ToolCall, Usage, StreamChunk } from '../types';
import { parseSSE } from './sse';
import { GeminiClient } from './gemini';

export interface LLMClientInterface {
  chatStreamWithTools(
    messages: Message[],
    tools: Tool[],
    onDelta: ((delta: string) => void) | null,
    signal?: AbortSignal,
  ): Promise<{ message: Message; usage: Usage | null }>;
}

export interface LLMClientConfig {
  apiBase: string;
  apiKey: string;
  model: string;
  stream?: boolean;
}

export class LLMClient implements LLMClientInterface {
  private apiBase: string;
  private apiKey: string;
  private model: string;
  private stream: boolean;

  constructor(config: LLMClientConfig) {
    this.apiBase = config.apiBase.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.stream = config.stream ?? true;
  }

  async chatStreamWithTools(
    messages: Message[],
    tools: Tool[],
    onDelta: ((delta: string) => void) | null,
    signal?: AbortSignal,
  ): Promise<{ message: Message; usage: Usage | null }> {
    if (!this.stream) return this.chatNonStream(messages, tools, onDelta, signal);

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (tools.length > 0) body.tools = tools;

    const resp = await fetch(`${this.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`LLM API error ${resp.status}: ${text}`);
    }

    if (!resp.body) throw new Error('Response body is null');

    const assembled: Message = { role: 'assistant', content: '' };
    const toolCallMap = new Map<number, ToolCall>();
    let usage: Usage | null = null;

    for await (const chunk of parseSSE(resp.body)) {
      if (chunk.usage) usage = chunk.usage;
      if (!chunk.choices?.length) continue;

      const delta = chunk.choices[0].delta;

      if (delta.content) {
        assembled.content += delta.content;
        onDelta?.(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          let existing = toolCallMap.get(tc.index);
          if (!existing) {
            existing = {
              id: tc.id ?? '',
              type: 'function',
              function: { name: tc.function?.name ?? '', arguments: '' },
            };
            toolCallMap.set(tc.index, existing);
          }
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name = tc.function.name;
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
        }
      }
    }

    if (toolCallMap.size > 0) {
      const maxIdx = Math.max(...toolCallMap.keys());
      assembled.tool_calls = [];
      for (let i = 0; i <= maxIdx; i++) {
        const tc = toolCallMap.get(i);
        if (tc) assembled.tool_calls.push(tc);
      }
    }

    return { message: assembled, usage };
  }

  private async chatNonStream(
    messages: Message[],
    tools: Tool[],
    onDelta: ((delta: string) => void) | null,
    signal?: AbortSignal,
  ): Promise<{ message: Message; usage: Usage | null }> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
    };
    if (tools.length > 0) body.tools = tools;

    const resp = await fetch(`${this.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`LLM API error ${resp.status}: ${text}`);
    }

    const data = await resp.json() as {
      choices?: Array<{ message: Message }>;
      usage?: Usage;
    };

    if (!data.choices?.length) {
      return { message: { role: 'assistant', content: '' }, usage: data.usage ?? null };
    }

    const msg = data.choices[0].message;
    if (msg.content && onDelta) onDelta(msg.content);

    return { message: msg, usage: data.usage ?? null };
  }
}

/**
 * Pick the right client by URL: Gemini native for googleapis.com
 * (excluding the /openai compatibility layer), OpenAI-compatible for everything else.
 */
export function newAutoClient(config: LLMClientConfig): LLMClientInterface {
  if (config.apiBase.includes('googleapis.com') && !config.apiBase.includes('/openai')) {
    return new GeminiClient(config);
  }
  return new LLMClient(config);
}
