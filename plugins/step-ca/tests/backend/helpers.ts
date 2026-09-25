import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import express, { type Router } from "express";
import {
  createMockCtx,
  createTestDb,
  type MockPluginContext,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import type {
  PluginFetchInit,
  PluginSshAuthProvider,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

/** A fake terminal socket that records what it was sent. */
export function fakeSocket() {
  const sent: Array<Record<string, unknown>> = [];
  const closers: Array<() => void> = [];
  return {
    sent,
    socket: {
      send: (data: string) => sent.push(JSON.parse(data)),
      on: (_event: "close", listener: () => void) => closers.push(listener),
    },
    close: () => closers.forEach((listener) => listener()),
  };
}

export interface TestServer {
  db: TestDb;
  mock: MockPluginContext;
  provider: () => PluginSshAuthProvider;
  get: (path: string) => Promise<{ status: number; body: string }>;
  close: () => Promise<void>;
}

export async function startServer(
  options: {
    settings?: Record<string, unknown>;
    fetch?: (url: string, init?: PluginFetchInit) => Promise<Response>;
  } = {},
): Promise<TestServer> {
  const db = await createTestDb(pluginDir);
  db.sqlite
    .prepare("INSERT OR IGNORE INTO users (id) VALUES (?)")
    .run("user-1");
  db.sqlite.prepare("INSERT OR IGNORE INTO ssh_data (id) VALUES (?)").run(7);

  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    settings: options.settings,
    fetch: options.fetch,
    baseUrl: "https://termix.test",
  });

  const { activate } = await import("../../src/backend/index.js");
  await activate(mock.ctx);

  const app = express();
  app.use((req, res, next) => router!(req, res, next));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    db,
    mock,
    provider: () =>
      mock.auth.sshAuthProviders.find(
        (provider) => provider.type === "stepca",
      )!,
    async get(path) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        redirect: "manual",
      });
      return { status: response.status, body: await response.text() };
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}

export const env = (hostId = 7) => ({
  client: {},
  userId: "user-1",
  hostId,
  purpose: "terminal",
  interactive: true,
  log: () => {},
});

export const HOST = { id: 7, ip: "10.0.0.7", port: 22, username: "root" };
