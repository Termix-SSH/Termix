import { afterEach, expect, it } from "vitest";
import { createAgentStore } from "../../../src/backend/agents/store.js";
import type { AgentEvent } from "../../../src/backend/agents/types.js";
import { startServer, type TestServer } from "../helpers.js";
let server: TestServer;
afterEach(async () => {
  await server?.close();
});
async function seed(id: string, events: Omit<AgentEvent, "seq">[] = []) {
  const store = await createAgentStore(server.mock.ctx);
  const session = {
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
  };
  await store.save(session);
  await store.append(
    session,
    events.map((e, i) => ({ ...e, seq: i + 1 })),
  );
}
it("requires the separate agent permission even when AI is enabled", async () => {
  server = await startServer();
  await server.enableFor("user-1");
  expect((await server.request("GET", "/agents")).status).toBe(403);
});
it("respects the global AI gate for agent routes", async () => {
  server = await startServer({ permissions: ["ai.agents"] });
  expect((await server.request("GET", "/agents")).status).toBe(403);
  await server.enableFor("user-1");
  expect((await server.request("GET", "/agents")).status).toBe(200);
});
it("does not expose another user's persisted session or allow a malformed launch", async () => {
  server = await startServer({ permissions: ["ai.agents"] });
  await server.enableFor("user-1");
  await server.enableFor("user-2");
  const id = "11111111-1111-1111-1111-111111111111";
  await seed(id, [{ kind: "text", text: "private transcript" }]);
  const other = await server.request("GET", `/agents/${id}`, {
    user: "user-2",
  });
  expect(other.status).toBe(400);
  expect(JSON.stringify(other.body)).not.toContain("private transcript");
  const invalid = await server.request("POST", "/agents", {
    body: {
      agent: "pi",
      hostId: 1,
      providerId: 1,
      model: "test",
      cwd: "/tmp",
      executable: "pi; uname",
    },
  });
  expect(invalid.status).toBe(400);
});
it("gates installation before SSH and rejects caller-supplied commands", async () => {
  server = await startServer();
  await server.enableFor("user-1");
  expect(
    (
      await server.request("POST", "/agents/install", {
        body: { hostId: 1, agent: "pi" },
      })
    ).status,
  ).toBe(403);
});
it("rejects arbitrary installer names", async () => {
  server = await startServer({ permissions: ["ai.agents"] });
  await server.enableFor("user-1");
  expect(
    (
      await server.request("POST", "/agents/install", {
        body: { hostId: 1, agent: "pi; id" },
      })
    ).status,
  ).toBe(400);
});
it("requires agent permission for forwarding configuration", async () => {
  server = await startServer();
  await server.enableFor("user-1");
  expect(
    (
      await server.request("POST", "/agents/forwarding", {
        body: { hostId: 1 },
      })
    ).status,
  ).toBe(403);
});

it("persists session metadata and queued drafts without exposing them to another user", async () => {
  server = await startServer({ permissions: ["ai.agents"] });
  await server.enableFor("user-1");
  await server.enableFor("user-2");
  const id = "22222222-2222-2222-2222-222222222222";
  await seed(id);
  expect(
    (
      await server.request("PATCH", `/agents/${id}`, {
        body: { title: "Private", draft: "Keep this draft" },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await server.request("POST", `/agents/${id}/queue`, {
        body: { operation: "add", text: "queued" },
      })
    ).status,
  ).toBe(200);
  const s = (await server.request("GET", `/agents/${id}`)).body;
  expect(s).toMatchObject({
    title: "Private",
    draft: "Keep this draft",
    queue: [{ text: "queued" }],
  });
  for (const [method, path, body] of [
    ["PATCH", `/agents/${id}`, { title: "hijack" }],
    ["POST", `/agents/${id}/queue`, { operation: "add", text: "injected" }],
    ["POST", `/agents/${id}/workspace`, { operation: "status" }],
  ] as const)
    expect(
      (await server.request(method, path, { user: "user-2", body })).status,
    ).toBe(400);
  await server.request("PATCH", `/agents/${id}`, { body: { archived: true } });
  expect((await server.request("POST", `/agents/${id}/resume`)).status).toBe(
    400,
  );
  expect((await server.request("GET", `/agents/${id}`)).body).toMatchObject({
    archived: true,
    queuePaused: true,
  });
});
