import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChunk } from "../../ai/providers/types.js";

const streamChat = vi.fn();
const handler = vi.fn();

vi.mock("../../ai/providers/registry.js", () => ({
  getAdapter: () => ({ streamChat, listModels: async () => [] }),
}));

vi.mock("../../ai/tools/catalog.js", () => ({
  getTool: (name: string) =>
    name === "list_hosts"
      ? {
          name: "list_hosts",
          description: "List hosts",
          category: "read",
          parameters: { type: "object", properties: {} },
          handler,
        }
      : undefined,
  toolDefinitions: () => [
    { name: "list_hosts", description: "List hosts", parameters: {} },
  ],
}));

const { runAgent } = await import("../../ai/engine.js");

function chunks(...values: ChatChunk[]) {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

const BASE = {
  config: { providerType: "ollama" as const },
  model: "test",
  system: "system",
  context: {
    userId: "user-1",
    conversationId: 1,
    allowReadOnlyCommands: false,
  },
};

async function collect(history: any[] = []) {
  const events: any[] = [];
  for await (const event of runAgent({ ...BASE, history })) {
    events.push(event);
  }
  return events;
}

describe("runAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams text and finishes when no tools are called", async () => {
    streamChat.mockReturnValueOnce(
      chunks({ type: "text", text: "hello" }, { type: "done" }),
    );

    const events = await collect();

    expect(events.filter((e) => e.type === "token")).toHaveLength(1);
    expect(events.at(-1).type).toBe("done");
  });

  it("runs a known tool and feeds the result back", async () => {
    handler.mockResolvedValue({ hosts: [{ id: 1, name: "web-1" }] });
    streamChat
      .mockReturnValueOnce(
        chunks(
          {
            type: "tool_call",
            call: { id: "c1", name: "list_hosts", arguments: {} },
          },
          { type: "done" },
        ),
      )
      .mockReturnValueOnce(
        chunks({ type: "text", text: "ok" }, { type: "done" }),
      );

    const events = await collect();

    expect(handler).toHaveBeenCalledOnce();
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it("refuses a tool that is not in the catalog", async () => {
    streamChat
      .mockReturnValueOnce(
        chunks(
          {
            type: "tool_call",
            call: { id: "c1", name: "read_credentials", arguments: {} },
          },
          { type: "done" },
        ),
      )
      .mockReturnValueOnce(
        chunks({ type: "text", text: "ok" }, { type: "done" }),
      );

    const events = await collect();

    // A model can emit any name it likes; only the catalog decides what runs.
    expect(handler).not.toHaveBeenCalled();
    const result = events.find((e) => e.type === "tool_result");
    expect(JSON.stringify(result.result)).toContain("Unknown tool");
  });

  it("surfaces a handler failure without ending the run", async () => {
    handler.mockRejectedValue(new Error("database is down"));
    streamChat
      .mockReturnValueOnce(
        chunks(
          {
            type: "tool_call",
            call: { id: "c1", name: "list_hosts", arguments: {} },
          },
          { type: "done" },
        ),
      )
      .mockReturnValueOnce(
        chunks({ type: "text", text: "ok" }, { type: "done" }),
      );

    const events = await collect();

    const result = events.find((e) => e.type === "tool_result");
    expect(JSON.stringify(result.result)).toContain("database is down");
    expect(events.at(-1).type).toBe("done");
  });

  it("closes the tool call when a tool returns a proposal", async () => {
    // Without a matching tool_result the call rendered as permanently
    // running, even though the work was done and awaiting the user.
    handler.mockResolvedValue({
      __proposal: true,
      kind: "propose_create_host",
      summary: "Add host web-1",
      payload: {},
    });
    streamChat
      .mockReturnValueOnce(
        chunks(
          {
            type: "tool_call",
            call: { id: "c1", name: "list_hosts", arguments: {} },
          },
          { type: "done" },
        ),
      )
      .mockReturnValueOnce(
        chunks({ type: "text", text: "ok" }, { type: "done" }),
      );

    const events = await collect();

    const callIndex = events.findIndex((e) => e.type === "tool_call");
    const resultIndex = events.findIndex((e) => e.type === "tool_result");
    const proposalIndex = events.findIndex((e) => e.type === "proposal");

    expect(resultIndex).toBeGreaterThan(callIndex);
    expect(proposalIndex).toBeGreaterThan(resultIndex);
    expect(events[resultIndex]).toMatchObject({
      name: "list_hosts",
      result: { status: "awaiting_user_approval" },
    });
  });

  it("reports a provider failure as an error and stops", async () => {
    streamChat.mockImplementationOnce(() => {
      throw new Error("provider unreachable");
    });

    const events = await collect();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      message: "provider unreachable",
    });
  });

  it("stops after too many tool turns", async () => {
    handler.mockResolvedValue({ ok: true });
    streamChat.mockImplementation(() =>
      chunks(
        {
          type: "tool_call",
          call: { id: "c", name: "list_hosts", arguments: {} },
        },
        { type: "done" },
      ),
    );

    const events = await collect();

    // A model that never stops calling tools must not spin forever.
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(streamChat.mock.calls.length).toBeLessThanOrEqual(8);
  });
});
