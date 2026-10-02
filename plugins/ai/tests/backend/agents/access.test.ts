import { afterEach, expect, it } from "vitest";
import { startServer, type TestServer } from "../helpers.js";
let server: TestServer;
afterEach(async () => {
  await server?.close();
});
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
  await server.mock.ctx.kv.set(`agent:user-1:${id}`, {
    id,
    userId: "user-1",
    hostId: 1,
    events: [{ text: "private transcript" }],
    updatedAt: new Date().toISOString(),
  });
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
