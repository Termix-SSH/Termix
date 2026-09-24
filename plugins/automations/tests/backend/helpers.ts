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
  PluginHostSummary,
  PluginNotificationChannel,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import type { AutomationsAccessV1 } from "../../src/backend/service.js";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

export const ALL_PERMISSIONS = [
  "automations.view",
  "automations.create",
  "automations.edit",
  "automations.delete",
  "automations.run",
];

/** Core's notification_channels, which automation_channels points at. */
export const NOTIFICATION_CHANNELS_DDL = `
  CREATE TABLE notification_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

export function host(id: number, userId = "alice"): PluginHostSummary {
  return {
    id,
    userId,
    name: `host-${id}`,
    ip: `10.0.0.${id}`,
    port: 22,
    username: "root",
    tags: null,
    folder: null,
    authType: "password",
  };
}

/** A snippets.access provider, always there since snippets is a hard dependency. */
export function fakeSnippets() {
  return {
    list: async () => [{ id: 5, name: "Restart nginx", isNote: false }],
    get: async (id: number) =>
      id === 5
        ? {
            id: 5,
            name: "Restart nginx",
            content: "systemctl restart nginx",
            isNote: false,
          }
        : null,
    resolveCommand: async (id: number) =>
      id === 5 ? "systemctl restart nginx" : null,
  };
}

export interface TestServer {
  db: TestDb;
  mock: MockPluginContext;
  service: AutomationsAccessV1;
  request: (
    method: string,
    path: string,
    options?: { user?: string | null; body?: unknown },
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any }>;
  /** Waits until a run for the automation reaches a final status. */
  waitForRun: (
    automationId: number,
  ) => Promise<{ status: string; error: string | null }>;
  close: () => Promise<void>;
}

/**
 * The plugin activated against a real in-memory database, its router mounted
 * the way core mounts it: JSON parsed and the acting user set from the
 * request, everything else left to the plugin.
 */
export async function startServer(
  options: {
    permissions?: string[];
    services?: Record<string, object>;
    hosts?: PluginHostSummary[];
    channels?: PluginNotificationChannel[];
    before?: (db: TestDb["sqlite"]) => void;
  } = {},
): Promise<TestServer> {
  const db = await createTestDb(pluginDir, {
    before: (sqlite) => {
      sqlite.exec(NOTIFICATION_CHANNELS_DDL);
      options.before?.(sqlite);
    },
  });
  for (const user of ["alice", "bob"]) {
    db.sqlite
      .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
      .run(user, user);
  }
  const channels = options.channels ?? [
    { id: 1, name: "ops", type: "webhook", enabled: true },
  ];
  for (const channel of channels) {
    db.sqlite
      .prepare(
        "INSERT INTO notification_channels (id, user_id, name, type, config, enabled) VALUES (?, 'alice', ?, ?, '{}', ?)",
      )
      .run(channel.id, channel.name, channel.type, channel.enabled ? 1 : 0);
  }

  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    permissions: options.permissions ?? ALL_PERMISSIONS,
    hosts: options.hosts ?? [host(1), host(2)],
    notificationChannels: channels,
    services: { "snippets.access": fakeSnippets(), ...options.services },
  });

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
    service: mock.services.get("automations.access") as AutomationsAccessV1,
    async request(method, path, { user = "alice", body: given } = {}) {
      const body = method === "GET" ? undefined : given;
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
          ...(user ? { "x-test-user": user } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async waitForRun(automationId) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const row = db.sqlite
          .prepare(
            "SELECT status, error FROM p_automations_runs WHERE automation_id = ? AND status != 'running' ORDER BY id DESC LIMIT 1",
          )
          .get(automationId) as
          { status: string; error: string | null } | undefined;
        if (row) return row;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`No finished run for automation ${automationId}`);
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const dispose of [...mock.disposals].reverse()) {
        await Promise.resolve(dispose()).catch(() => {});
      }
      db.close();
    },
  };
}

/** A definition with one step, for tests that only care about the trigger. */
export function definition(
  trigger: Record<string, unknown>,
  steps: Array<Record<string, unknown>> = [
    { id: "v", type: "set_var", name: "done", value: "yes" },
  ],
) {
  return { version: 1, trigger, steps };
}
