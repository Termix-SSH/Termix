import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChunk } from "../../ai/providers/types.js";

const providerFetch = vi.fn();

vi.mock("../../ai/providers/http.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../ai/providers/http.js")
  >("../../ai/providers/http.js");
  return { ...actual, providerFetch };
});

const { openAiAdapter } = await import("../../ai/providers/openai.js");
const { ollamaAdapter } = await import("../../ai/providers/ollama.js");
const { geminiAdapter } = await import("../../ai/providers/gemini.js");

/** Builds a Response whose body streams the given text chunks. */
function streamingResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        let index = 0;
        return {
          async read() {
            if (index >= lines.length) return { done: true, value: undefined };
            return { done: false, value: encoder.encode(lines[index++]) };
          },
          releaseLock() {},
        };
      },
    },
  } as unknown as Response;
}

/** One SSE frame, built from an object so the JSON stays readable. */
function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n`;
}

async function collect(iterable: AsyncIterable<ChatChunk>) {
  const chunks: ChatChunk[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

const REQUEST = {
  model: "test-model",
  system: "system",
  messages: [{ role: "user" as const, content: "hi" }],
  tools: [],
};

describe("openAiAdapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalises streamed text", async () => {
    providerFetch.mockResolvedValue(
      streamingResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        "data: [DONE]\n",
      ]),
    );

    const chunks = await collect(
      openAiAdapter.streamChat({ providerType: "openai" }, REQUEST),
    );

    expect(chunks.filter((c) => c.type === "text")).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
    ]);
    expect(chunks.at(-1)?.type).toBe("done");
  });

  it("reassembles tool arguments split across deltas", async () => {
    providerFetch.mockResolvedValue(
      streamingResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"list_hosts","arguments":"{\\"a"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\":1}"}}]}}]}\n',
        "data: [DONE]\n",
      ]),
    );

    const chunks = await collect(
      openAiAdapter.streamChat({ providerType: "openai" }, REQUEST),
    );

    const call = chunks.find((c) => c.type === "tool_call");
    expect(call).toMatchObject({
      type: "tool_call",
      call: { id: "c1", name: "list_hosts", arguments: { a: 1 } },
    });
  });

  it("survives malformed tool arguments", async () => {
    // A model that emits broken JSON gets an empty object; the tool's own
    // validation then reports the problem back to it.
    providerFetch.mockResolvedValue(
      streamingResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"list_hosts","arguments":"{not json"}}]}}]}\n',
        "data: [DONE]\n",
      ]),
    );

    const chunks = await collect(
      openAiAdapter.streamChat({ providerType: "openai" }, REQUEST),
    );

    expect(chunks.find((c) => c.type === "tool_call")).toMatchObject({
      call: { arguments: {} },
    });
  });

  it("needs a base url for an openai-compatible provider", async () => {
    await expect(
      collect(
        openAiAdapter.streamChat(
          { providerType: "openai_compatible" },
          REQUEST,
        ),
      ),
    ).rejects.toThrow("base URL");
  });
});

describe("ollamaAdapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads newline-delimited json rather than sse", async () => {
    providerFetch.mockResolvedValue(
      streamingResponse([
        '{"message":{"content":"Hel"}}\n',
        '{"message":{"content":"lo"}}\n',
        '{"done":true,"done_reason":"stop"}\n',
      ]),
    );

    const chunks = await collect(
      ollamaAdapter.streamChat({ providerType: "ollama" }, REQUEST),
    );

    expect(chunks.filter((c) => c.type === "text")).toHaveLength(2);
    expect(chunks.at(-1)).toMatchObject({ type: "done", stopReason: "stop" });
  });

  it("accepts tool arguments as an object or a json string", async () => {
    providerFetch.mockResolvedValue(
      streamingResponse([
        '{"message":{"tool_calls":[{"function":{"name":"list_hosts","arguments":{"a":1}}}]}}\n',
        '{"message":{"tool_calls":[{"function":{"name":"get_host","arguments":"{\\"hostId\\":2}"}}]}}\n',
        '{"done":true}\n',
      ]),
    );

    const chunks = await collect(
      ollamaAdapter.streamChat({ providerType: "ollama" }, REQUEST),
    );

    const calls = chunks.filter((c) => c.type === "tool_call") as any[];
    expect(calls[0].call.arguments).toEqual({ a: 1 });
    expect(calls[1].call.arguments).toEqual({ hostId: 2 });
  });
});

describe("geminiAdapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("carries thoughtSignature off a function call", async () => {
    // Gemini 2.5+ 400s a follow-up whose functionCall parts lost their
    // signature, which broke every conversation on the second turn.
    providerFetch.mockResolvedValue(
      streamingResponse([
        sseFrame({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: { name: "list_hosts", args: {} },
                    thoughtSignature: "sig-abc",
                  },
                ],
              },
            },
          ],
        }),
      ]),
    );

    const chunks = await collect(
      geminiAdapter.streamChat(
        { providerType: "gemini", apiKey: "k" },
        REQUEST,
      ),
    );

    expect(chunks.find((c) => c.type === "tool_call")).toMatchObject({
      call: { name: "list_hosts", providerSignature: "sig-abc" },
    });
  });

  it("echoes the signature back on the next turn", async () => {
    providerFetch.mockResolvedValue(streamingResponse([]));

    await collect(
      geminiAdapter.streamChat(
        { providerType: "gemini", apiKey: "k" },
        {
          ...REQUEST,
          messages: [
            { role: "user", content: "hi" },
            {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "c1",
                  name: "list_hosts",
                  arguments: {},
                  providerSignature: "sig-abc",
                },
              ],
            },
            {
              role: "tool",
              content: "{}",
              toolCallId: "c1",
              toolName: "list_hosts",
            },
          ],
        },
      ),
    );

    const body = JSON.parse(providerFetch.mock.calls[0][1].body as string);
    const modelTurn = body.contents.find((c: any) => c.role === "model");
    expect(modelTurn.parts[0].thoughtSignature).toBe("sig-abc");
  });
});

describe("assertOk error messages", () => {
  beforeEach(() => vi.clearAllMocks());

  function errorResponse(status: number, body: string): Response {
    return {
      ok: false,
      status,
      text: async () => body,
    } as unknown as Response;
  }

  it("pulls the message out of a nested error body", async () => {
    // Slicing the raw JSON used to cut the text off mid-sentence.
    providerFetch.mockResolvedValue(
      errorResponse(
        400,
        JSON.stringify({
          error: {
            code: 400,
            message: "Function call is missing a signature.",
          },
        }),
      ),
    );

    await expect(
      collect(openAiAdapter.streamChat({ providerType: "openai" }, REQUEST)),
    ).rejects.toThrow("Function call is missing a signature.");
  });

  it("explains a rate limit instead of dumping the body", async () => {
    providerFetch.mockResolvedValue(
      errorResponse(
        429,
        JSON.stringify({ error: { message: "You exceeded your quota." } }),
      ),
    );

    await expect(
      collect(openAiAdapter.streamChat({ providerType: "openai" }, REQUEST)),
    ).rejects.toThrow(/rate limit reached/i);
  });

  it("explains a rejected key", async () => {
    providerFetch.mockResolvedValue(
      errorResponse(401, JSON.stringify({ error: { message: "Bad key" } })),
    );

    await expect(
      collect(openAiAdapter.streamChat({ providerType: "openai" }, REQUEST)),
    ).rejects.toThrow(/rejected the API key/i);
  });

  it("falls back to a trimmed snippet for a non-JSON body", async () => {
    providerFetch.mockResolvedValue(errorResponse(500, "upstream exploded"));

    await expect(
      collect(openAiAdapter.streamChat({ providerType: "openai" }, REQUEST)),
    ).rejects.toThrow("upstream exploded");
  });
});
