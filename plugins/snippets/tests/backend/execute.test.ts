import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { EventEmitter } from "node:events";
import {
  createMockCtx,
  createTestDb,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import { manifest, pluginDir } from "./helpers";

let db: TestDb | null = null;

afterEach(async () => {
  db?.close();
  db = null;
});

function fakeSshClient(output: string, exitCode: number | null = 0) {
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
    cb(null, stream);
    setImmediate(() => {
      stream.emit("data", Buffer.from(output));
      stream.emit("close", exitCode);
    });
  };
  return client;
}

async function startExecuteServer(sshClient: unknown) {
  db = await createTestDb(pluginDir);
  db.sqlite
    .prepare("INSERT INTO users (id, username) VALUES ('user-1', 'user-1')")
    .run();

  let router: import("express").Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    sshClient,
    permissions: ["snippets.view", "snippets.create"],
  });

  const { activate } = await import("../../src/backend/index.js");
  await activate(mock.ctx);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    mock.setActor(req.header("x-test-user") ?? undefined);
    next();
  });
  app.use((req, res, next) => router!(req, res, next));

  const http = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as import("node:net").AddressInfo;

  return {
    async request(method: string, path: string, body?: unknown) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
          "x-test-user": "user-1",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("POST /execute", () => {
  it("runs the resolved command over the ssh client and reports success", async () => {
    const client = fakeSshClient("deployed ok", 0);
    const server = await startExecuteServer(client);
    try {
      const created = await server.request("POST", "/", {
        name: "Deploy",
        content: "echo $HOST",
      });
      const result = await server.request("POST", "/execute", {
        snippetId: created.body.id,
        hostId: 42,
      });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ success: true, output: "deployed ok" });
    } finally {
      await server.close();
    }
  });

  it("reports failure from a nonzero exit code", async () => {
    const client = fakeSshClient("", 1);
    const server = await startExecuteServer(client);
    try {
      const created = await server.request("POST", "/", {
        name: "Fails",
        content: "exit 1",
      });
      const result = await server.request("POST", "/execute", {
        snippetId: created.body.id,
        hostId: 42,
      });
      expect(result.status).toBe(200);
      expect(result.body.success).toBe(false);
    } finally {
      await server.close();
    }
  });
});
