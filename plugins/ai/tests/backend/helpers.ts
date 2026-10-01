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
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

export const ALL_PERMISSIONS = [
  "ai.use",
  "ai.manage_providers",
  "ai.apply_proposals",
];

export interface TestServer {
  db: TestDb;
  mock: MockPluginContext;
  request: (
    method: string,
    path: string,
    options?: { user?: string; body?: unknown },
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any }>;
  /** Turns the assistant on for the server and opts `userId` in. */
  enableFor: (userId: string) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * The plugin activated against a real in-memory database, its router mounted
 * on an express app the way core mounts it: JSON parsed, the acting user set
 * from the request, everything else left to the plugin.
 */
export async function startServer(
  options: {
    permissions?: string[];
    services?: Record<string, object>;
    fetch?: (url: string, init?: unknown) => Promise<Response>;
  } = {},
): Promise<TestServer> {
  const db = await createTestDb(pluginDir);
  for (const user of ["user-1", "user-2"]) {
    db.sqlite
      .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
      .run(user, user);
  }

  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    permissions: options.permissions ?? ALL_PERMISSIONS,
    services: options.services,
    fetch: options.fetch as never,
    hosts: [
      {
        id: 1,
        userId: "user-1",
        name: "web-1",
        ip: "10.0.0.1",
        port: 22,
        username: "root",
        tags: "prod",
        folder: null,
        authType: "password",
      },
    ],
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

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    db,
    mock,
    async request(method, path, { user = "user-1", body: given } = {}) {
      const body = method === "GET" ? undefined : given;
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
          "x-test-user": user,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed };
    },
    async enableFor(userId) {
      await mock.ctx.settings.set("globallyEnabled", true);
      await mock.ctx.settings.setUser(userId, "enabled", true);
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}

// The four tables as core's SQLite bootstrap created them before 2.9.0, with
// the indexes performance-indexes.ts added.
export const LEGACY_DDL = `
  CREATE TABLE ai_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL,
    label TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT,
    api_key_prefix TEXT,
    default_model TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, label)
  );
  CREATE TABLE ai_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    provider_id INTEGER,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE ai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tool_calls TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE ai_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    summary TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    applied_at TEXT,
    result_summary TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_ai_providers_user_label ON ai_providers (user_id, label);
  CREATE INDEX idx_ai_conversations_user ON ai_conversations (user_id, updated_at);
  CREATE INDEX idx_ai_messages_conversation ON ai_messages (conversation_id, created_at);
  CREATE INDEX idx_ai_proposals_user ON ai_proposals (user_id, status);
  CREATE INDEX idx_ai_proposals_conversation ON ai_proposals (conversation_id);
`;
