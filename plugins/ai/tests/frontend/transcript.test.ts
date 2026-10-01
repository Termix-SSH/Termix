import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  finishedRunEntries,
  userEntry,
} from "../../src/frontend/transcript";

describe("finishedRunEntries", () => {
  it("keeps the run's tool steps ahead of its reply", () => {
    const entries = finishedRunEntries(
      2,
      [{ id: "tool-0", name: "list_hosts", arguments: {}, result: [] }],
      "done",
    );
    expect(entries).toEqual([
      {
        kind: "tool",
        tool: {
          id: "run-2-tool-0",
          name: "list_hosts",
          arguments: {},
          result: [],
        },
      },
      { kind: "message", role: "assistant", content: "done" },
    ]);
  });

  it("adds no empty reply", () => {
    expect(finishedRunEntries(0, [], "")).toEqual([]);
  });
});

describe("buildTimeline", () => {
  it("keeps past steps when a new run starts", () => {
    const history = [
      userEntry("check"),
      ...finishedRunEntries(
        0,
        [{ id: "tool-0", name: "list_hosts", arguments: {} }],
        "",
      ),
      userEntry("continue"),
    ];
    const timeline = buildTimeline(
      history,
      {
        tools: [{ id: "tool-0", name: "get_host", arguments: {} }],
        assistantText: "hi",
      },
      [],
    );

    expect(timeline.map((item) => item.kind)).toEqual([
      "message",
      "tool",
      "message",
      "tool",
      "message",
    ]);
    const tools = timeline.filter((item) => item.kind === "tool");
    expect(tools.map((item) => item.live)).toEqual([false, true]);
    expect(new Set(timeline.map((item) => item.key)).size).toBe(
      timeline.length,
    );
  });
});
