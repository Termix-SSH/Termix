import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import express, { type Router } from "express";
import {
  createFakeProcess,
  createMockCtx,
  createTestDb,
  type FakeProcess,
  type MockPluginContext,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import type {
  PluginHostSummary,
  PluginSshAuthProvider,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

/** Core's 2.8 opkssh_tokens, as db/index.ts created it. */
export const LEGACY_DDL = `
  CREATE TABLE IF NOT EXISTS opkssh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    host_id INTEGER NOT NULL,
    ssh_cert TEXT NOT NULL,
    private_key TEXT NOT NULL,
    email TEXT,
    sub TEXT,
    issuer TEXT,
    audience TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    last_used TEXT,
    UNIQUE(user_id, host_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
  );
`;

export const PROVIDERS_CONFIG = `providers:
  - alias: google
    issuer: https://accounts.google.com
    client_id: abc
    scopes: openid email
`;

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
  dataDir: string;
  processes: FakeProcess[];
  provider: () => PluginSshAuthProvider;
  request: (
    method: string,
    path: string,
    options?: { user?: string; headers?: Record<string, string> },
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any; location: string | null }>;
  close: () => Promise<void>;
}

export async function startServer(
  options: {
    capabilities?: string[];
    hosts?: PluginHostSummary[];
    settings?: Record<string, unknown>;
    before?: (sqlite: TestDb["sqlite"]) => void;
  } = {},
): Promise<TestServer> {
  const db = await createTestDb(pluginDir, { before: options.before });
  db.sqlite
    .prepare("INSERT OR IGNORE INTO users (id) VALUES (?)")
    .run("user-1");
  db.sqlite.prepare("INSERT OR IGNORE INTO ssh_data (id) VALUES (?)").run(7);
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "opkssh-"));
  const processes: FakeProcess[] = [];

  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: options.capabilities ?? manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    hosts: options.hosts ?? [
      {
        id: 7,
        userId: "user-1",
        name: "box",
        ip: "10.0.0.7",
        port: 22,
        username: "root",
      } as PluginHostSummary,
    ],
    settings: options.settings,
    baseUrl: "https://termix.test",
    process: {
      run: () => {
        const child = createFakeProcess();
        processes.push(child);
        return child;
      },
      ensureBinary: async (spec) => `/opt/${spec.name}`,
    },
  });
  // The plugin's data folder, somewhere the test can write.
  (mock.ctx as unknown as { files: unknown }).files = {
    dataDir: async () => dataDir,
  };

  const { activate } = await import("../../src/backend/index.js");
  await activate(mock.ctx);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    mock.setActor(req.header("x-test-user") || undefined);
    next();
  });
  app.use((req, res, next) => router!(req, res, next));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    db,
    mock,
    dataDir,
    processes,
    provider: () =>
      mock.auth.sshAuthProviders.find(
        (provider) => provider.type === "opkssh",
      )!,
    async request(method, requestPath, { user = "user-1", headers = {} } = {}) {
      const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
        method,
        redirect: "manual",
        headers: { ...(user ? { "x-test-user": user } : {}), ...headers },
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return {
        status: response.status,
        body: parsed,
        location: response.headers.get("location"),
      };
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      await fs.rm(dataDir, { recursive: true, force: true });
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
