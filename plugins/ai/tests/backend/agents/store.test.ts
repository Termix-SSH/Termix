import { afterEach, expect, it } from "vitest";
import {
  createAgentStore,
  EVENT_HISTORY,
} from "../../../src/backend/agents/store.js";
import { startServer, type TestServer } from "../helpers.js";

let server: TestServer;
afterEach(async () => {
  await server?.close();
});

const session = (id: string) => ({
  id,
  userId: "user-1",
  hostId: 1,
  providerId: 1,
  agent: "pi" as const,
  model: "test",
  cwd: "/tmp",
  executable: "pi",
  status: "stopped" as const,
  events: [],
  updatedAt: new Date().toISOString(),
});

it("keeps saving a session whose history is far larger than one value", async () => {
  server = await startServer({ permissions: ["ai.agents"] });
  await server.enableFor("user-1");
  const store = await createAgentStore(server.mock.ctx);
  const id = "33333333-3333-3333-3333-333333333333";
  const s = session(id);
  await store.save(s);
  const chunk = "x".repeat(32000);
  let seq = 0;
  for (let batch = 0; batch < 30; batch++)
    await store.append(
      s,
      Array.from({ length: 100 }, () => ({
        seq: ++seq,
        kind: "tool" as const,
        text: chunk,
      })),
    );
  await store.save({
    ...s,
    nativeId: "native-1",
    queue: [{ id: "q1", text: "next", attachmentIds: [] }],
  });

  const stored = await store.get("user-1", id);
  expect(stored).toMatchObject({
    nativeId: "native-1",
    queue: [{ id: "q1", text: "next", attachmentIds: [] }],
  });
  const events = await store.events(id);
  expect(events).toHaveLength(EVENT_HISTORY);
  expect(events[0].seq).toBe(seq - EVENT_HISTORY + 1);
  expect(events.at(-1)?.seq).toBe(seq);
  expect(await store.events(id, seq - 2)).toHaveLength(2);
});

it("only returns a session to its owner and removes every row on delete", async () => {
  server = await startServer({ permissions: ["ai.agents"] });
  const store = await createAgentStore(server.mock.ctx);
  const id = "44444444-4444-4444-4444-444444444444";
  const s = session(id);
  await store.save({
    ...s,
    queue: [{ id: "q1", text: "a", attachmentIds: [] }],
  });
  await store.append(s, [{ seq: 1, kind: "user", text: "hello" }]);

  expect(await store.get("user-2", id)).toBeNull();
  expect(await store.list("user-2")).toEqual([]);
  expect((await store.list("user-1")).map((x) => x.id)).toEqual([id]);

  await store.delete(id);
  expect(await store.get("user-1", id)).toBeNull();
  expect(await store.events(id)).toEqual([]);
});

it("caps prompts and drafts by UTF-8 bytes so they fit MySQL TEXT", async () => {
  server = await startServer({ permissions: ["ai.agents"] });
  await server.enableFor("user-1");
  const id = "55555555-5555-5555-5555-555555555555";
  await (await createAgentStore(server.mock.ctx)).save(session(id));
  const wide = "界".repeat(30000);
  const draft = await server.request("PATCH", `/agents/${id}`, {
    body: { draft: wide },
  });
  expect(draft.status).toBe(400);
  const queued = await server.request("POST", `/agents/${id}/queue`, {
    body: { operation: "add", text: wide },
  });
  expect(queued.status).toBe(400);
  const ascii = await server.request("PATCH", `/agents/${id}`, {
    body: { draft: "a".repeat(64000) },
  });
  expect(ascii.status).toBe(200);
});
