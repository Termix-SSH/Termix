import { expect, it } from "vitest";
import {
  updateQueue,
  updateSession,
  promptInput,
} from "../../../src/backend/agents/session-state.js";
import type { AgentSession } from "../../../src/backend/agents/types.js";
const session = () =>
  ({ queue: [], attachments: [{ id: "image" }] }) as unknown as AgentSession;
it("queues, edits and removes messages without replacing their IDs", () => {
  const s = session();
  updateQueue(s, { operation: "add", text: "first" });
  updateQueue(s, { operation: "add", text: "second" });
  const id = s.queue![0].id;
  updateQueue(s, {
    operation: "update",
    id,
    text: "edited",
    attachmentIds: ["image"],
  });
  expect(s.queue![0]).toEqual({ id, text: "edited", attachmentIds: ["image"] });
  updateQueue(s, { operation: "pause" });
  expect(s.queuePaused).toBe(true);
  updateQueue(s, { operation: "continue" });
  expect(s.queuePaused).toBe(false);
  updateQueue(s, { operation: "remove", id });
  expect(s.queue!.map((p) => p.text)).toEqual(["second"]);
  expect(() =>
    updateQueue(s, { operation: "update", id, text: "late edit" }),
  ).toThrow();
});
it("rejects foreign attachments and caps queues", () => {
  const s = session();
  expect(() =>
    promptInput(s, { text: "x", attachmentIds: ["other-session"] }),
  ).toThrow();
  for (let i = 0; i < 20; i++) updateQueue(s, { operation: "add", text: "x" });
  expect(() =>
    updateQueue(s, { operation: "add", text: "overflow" }),
  ).toThrow();
});
it("validates metadata before applying changes", () => {
  const s = session();
  updateSession(s, { title: "name", draft: "draft", archived: true });
  expect(s).toMatchObject({ title: "name", draft: "draft", archived: true });
  expect(() => updateSession(s, { title: "replacement", draft: 42 })).toThrow();
  expect(s.title).toBe("name");
});
