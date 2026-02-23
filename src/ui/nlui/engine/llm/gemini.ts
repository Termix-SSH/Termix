import type { Message, Tool, Usage } from '../types';
import type { LLMClientInterface, LLMClientConfig } from './client';

// ── Gemini request/response types ──

interface GeminiRequest {
  contents: GeminiContent[];
  tools?: GeminiTool[];
  systemInstruction?: { parts: GeminiPart[] };
}

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters?: unknown;
  }>;
}

interface GeminiStreamChunk {
  candidates?: Array<{ content: GeminiContent }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// ── GeminiClient ──

export class GeminiClient implements LLMClientInterface {
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
    const reqBody = this.buildRequest(messages, tools);

    const action = this.stream
      ? `streamGenerateContent?alt=sse&key=${this.apiKey}`
      : `generateContent?key=${this.apiKey}`;
    const url = `${this.apiBase}/models/${this.model}:${action}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Gemini API error ${resp.status}: ${text}`);
    }

    if (this.stream) {
      if (!resp.body) throw new Error('Response body is null');
      return this.parseSSE(resp.body, onDelta);
    }
    return this.parseJSON(resp, onDelta);
  }

  // ── Build Gemini request ──

  private buildRequest(messages: Message[], tools: Tool[]): GeminiRequest {
    const req: GeminiRequest = { contents: [] };

    // Convert tools
    if (tools.length > 0) {
      req.tools = [{
        functionDeclarations: tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }

    // Build tool_call_id → function name map
    const tcNames = new Map<string, string>();
    for (const m of messages) {
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          tcNames.set(tc.id, tc.function.name);
        }
      }
    }

    // Convert messages; collect consecutive tool results into one user turn.
    let pendingToolParts: GeminiPart[] = [];

    const flushToolParts = () => {
      if (pendingToolParts.length === 0) return;
      req.contents.push({ role: 'user', parts: pendingToolParts });
      pendingToolParts = [];
    };

    for (const m of messages) {
      switch (m.role) {
        case 'system':
          req.systemInstruction = { parts: [{ text: m.content }] };
          break;

        case 'user':
          flushToolParts();
          req.contents.push({ role: 'user', parts: [{ text: m.content }] });
          break;

        case 'assistant': {
          flushToolParts();
          const parts: GeminiPart[] = [];
          if (m.content) parts.push({ text: m.content });
          if (m.tool_calls) {
            for (const tc of m.tool_calls) {
              let args: Record<string, unknown> | undefined;
              try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }
              parts.push({ functionCall: { name: tc.function.name, args } });
            }
          }
          if (parts.length > 0) {
            req.contents.push({ role: 'model', parts });
          }
          break;
        }

        case 'tool': {
          const name = tcNames.get(m.tool_call_id ?? '') ?? m.tool_call_id ?? '';
          pendingToolParts.push({
            functionResponse: { name, response: { result: m.content } },
          });
          break;
        }
      }
    }
    flushToolParts();

    return req;
  }

  // ── SSE parsing ──

  private async parseSSE(
    body: ReadableStream<Uint8Array>,
    onDelta: ((delta: string) => void) | null,
  ): Promise<{ message: Message; usage: Usage | null }> {
    const assembled: Message = { role: 'assistant', content: '' };
    let usage: Usage | null = null;
    let tcIndex = 0;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);

          let chunk: GeminiStreamChunk;
          try { chunk = JSON.parse(data); } catch { continue; }

          if (chunk.usageMetadata) {
            usage = {
              prompt_tokens: chunk.usageMetadata.promptTokenCount,
              completion_tokens: chunk.usageMetadata.candidatesTokenCount,
              total_tokens: chunk.usageMetadata.totalTokenCount,
            };
          }

          if (!chunk.candidates?.length) continue;

          for (const part of chunk.candidates[0].content.parts) {
            if (part.text) {
              assembled.content += part.text;
              onDelta?.(part.text);
            }
            if (part.functionCall) {
              const argsStr = part.functionCall.args
                ? JSON.stringify(part.functionCall.args)
                : '{}';
              if (!assembled.tool_calls) assembled.tool_calls = [];
              assembled.tool_calls.push({
                id: `gemini_${tcIndex}`,
                type: 'function',
                function: { name: part.functionCall.name, arguments: argsStr },
              });
              tcIndex++;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { message: assembled, usage };
  }

  // ── Non-stream JSON parsing ──

  private async parseJSON(
    resp: Response,
    onDelta: ((delta: string) => void) | null,
  ): Promise<{ message: Message; usage: Usage | null }> {
    const chunk = await resp.json() as GeminiStreamChunk;

    const assembled: Message = { role: 'assistant', content: '' };
    let usage: Usage | null = null;

    if (chunk.usageMetadata) {
      usage = {
        prompt_tokens: chunk.usageMetadata.promptTokenCount,
        completion_tokens: chunk.usageMetadata.candidatesTokenCount,
        total_tokens: chunk.usageMetadata.totalTokenCount,
      };
    }

    if (chunk.candidates?.length) {
      for (let i = 0; i < chunk.candidates[0].content.parts.length; i++) {
        const part = chunk.candidates[0].content.parts[i];
        if (part.text) assembled.content += part.text;
        if (part.functionCall) {
          const argsStr = part.functionCall.args
            ? JSON.stringify(part.functionCall.args)
            : '{}';
          if (!assembled.tool_calls) assembled.tool_calls = [];
          assembled.tool_calls.push({
            id: `gemini_${i}`,
            type: 'function',
            function: { name: part.functionCall.name, arguments: argsStr },
          });
        }
      }
    }

    if (assembled.content && onDelta) onDelta(assembled.content);

    return { message: assembled, usage };
  }
}
