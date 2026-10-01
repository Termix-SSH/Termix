import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { startServer, type TestServer } from "./helpers";

function fakeSshClient(outputs: Record<string, string>, exitCode = 0) {
  const client = new EventEmitter() as EventEmitter & {
    exec: (
      command: string,
      cb: (err: Error | null, stream: unknown) => void,
    ) => void;
  };
  client.exec = (command, cb) => {
    const stream = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
    };
    stream.stderr = new EventEmitter();
    const matchKey = Object.keys(outputs).find((k) => command.includes(k));
    const output = matchKey ? outputs[matchKey] : "";
    cb(null, stream);
    setImmediate(() => {
      if (output) stream.emit("data", Buffer.from(output));
      stream.emit("close", exitCode);
    });
  };
  return client;
}

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe("GET /:hostId/overview", () => {
  it("403s when the host does not exist or is not reachable", async () => {
    server = await startServer({ hosts: [] });
    const res = await server.request("GET", "/7/overview");
    expect(res.status).toBe(403);
  });

  it("403s when the monitor is disabled for the host", async () => {
    server = await startServer({ enabledHosts: [] });
    const res = await server.request("GET", "/7/overview");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not enabled/i);
  });

  it("403s without the tmux-monitor.use permission", async () => {
    server = await startServer({ permissions: [] });
    const res = await server.request("GET", "/7/overview");
    expect(res.status).toBe(403);
  });

  it("reports tmux unavailable when the exec exits non-zero", async () => {
    server = await startServer({ sshClient: fakeSshClient({}, 127) });
    const res = await server.request("GET", "/7/overview");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, sessions: [] });
  });
});

describe("PUT /:hostId/tags", () => {
  it("saves tags for the acting user and session", async () => {
    server = await startServer();
    const res = await server.request("PUT", "/7/tags", {
      body: { sessionName: "work", tags: ["a", "b", "b", "  "] },
    });
    expect(res.status).toBe(200);
    expect(res.body.tags.sort()).toEqual(["a", "b"]);
  });

  it("rejects a non-array tags field", async () => {
    server = await startServer();
    const res = await server.request("PUT", "/7/tags", {
      body: { sessionName: "work", tags: "nope" },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /:hostId/sessions", () => {
  it("rejects an invalid session name", async () => {
    server = await startServer();
    const res = await server.request("POST", "/7/sessions", {
      body: { name: "bad:name" },
    });
    expect(res.status).toBe(400);
  });
});
