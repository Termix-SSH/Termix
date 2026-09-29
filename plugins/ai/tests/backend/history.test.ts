import { describe, expect, it } from "vitest";
import { toChatHistory, toStoredMessage } from "../../src/backend/history.js";

const calls = [
  { id: "c1", name: "list_hosts", arguments: {} },
  { id: "c2", name: "get_host", arguments: { hostId: 1 } },
];

describe("toStoredMessage", () => {
  it("keeps the answered call on a tool row", () => {
    expect(
      toStoredMessage({
        role: "tool",
        content: "{}",
        toolCallId: "c1",
        toolName: "list_hosts",
      }),
    ).toEqual({
      role: "tool",
      content: "{}",
      toolCalls: JSON.stringify([{ id: "c1", name: "list_hosts" }]),
    });
  });

  it("stores no tool calls for a plain reply", () => {
    expect(toStoredMessage({ role: "assistant", content: "hi" })).toEqual({
      role: "assistant",
      content: "hi",
      toolCalls: null,
    });
  });
});

describe("toChatHistory", () => {
  it("round-trips a full run", () => {
    const rows = [
      { role: "user", content: "check", toolCalls: null },
      toStoredMessage({ role: "assistant", content: "", toolCalls: calls }),
      toStoredMessage({
        role: "tool",
        content: '{"hosts":[]}',
        toolCallId: "c1",
        toolName: "list_hosts",
      }),
      toStoredMessage({
        role: "tool",
        content: '{"host":{}}',
        toolCallId: "c2",
        toolName: "get_host",
      }),
      { role: "assistant", content: "done", toolCalls: null },
    ];

    expect(toChatHistory(rows)).toEqual([
      { role: "user", content: "check" },
      { role: "assistant", content: "", toolCalls: calls },
      {
        role: "tool",
        content: '{"hosts":[]}',
        toolCallId: "c1",
        toolName: "list_hosts",
      },
      {
        role: "tool",
        content: '{"host":{}}',
        toolCallId: "c2",
        toolName: "get_host",
      },
      { role: "assistant", content: "done" },
    ]);
  });

  it("fills in results for calls a cut off run never answered", () => {
    const rows = [
      { role: "user", content: "check", toolCalls: null },
      toStoredMessage({ role: "assistant", content: "", toolCalls: calls }),
      toStoredMessage({
        role: "tool",
        content: "{}",
        toolCallId: "c1",
        toolName: "list_hosts",
      }),
      { role: "user", content: "continue", toolCalls: null },
    ];

    const history = toChatHistory(rows);
    expect(history.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
    ]);
    expect(history[3]).toMatchObject({
      toolCallId: "c2",
      toolName: "get_host",
    });
    expect(JSON.parse(history[3].content).error).toMatch(/interrupted/);
  });

  it("repairs a legacy row saved with tool calls and no results", () => {
    const history = toChatHistory([
      { role: "assistant", content: "", toolCalls: JSON.stringify(calls) },
    ]);
    expect(history.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("drops tool rows that answer nothing", () => {
    expect(
      toChatHistory([
        { role: "tool", content: "{}", toolCalls: null },
        { role: "user", content: "hi", toolCalls: null },
      ]),
    ).toEqual([{ role: "user", content: "hi" }]);
  });
});
