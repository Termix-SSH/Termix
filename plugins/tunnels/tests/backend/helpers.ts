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
  PluginContext,
  PluginHostAccess,
  PluginHostSummary,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

export function host(
  overrides: Partial<PluginHostSummary> = {},
): PluginHostSummary {
  return {
    id: 7,
    userId: "user-1",
    name: "web",
    ip: "10.0.0.5",
    port: 22,
    username: "root",
    tags: null,
    folder: null,
    authType: "password",
    ...overrides,
  };
}

/**
 * Hosts each user can reach, standing in for ctx.hosts. createMockCtx has no
 * per-user host list, and tunnels checks access as the acting user.
 */
export function withHosts(
  mock: MockPluginContext,
  byUser: Record<string, PluginHostSummary[]>,
): void {
  const reachable = () => byUser[mock.ctx.currentActor() ?? ""] ?? [];
  const hosts = mock.ctx.hosts as PluginContext["hosts"] & {
    [key: string]: unknown;
  };
  Object.assign(hosts, {
    list: async () => reachable(),
    get: async (id: number) => reachable().find((h) => h.id === id) ?? null,
    checkAccess: async (id: number): Promise<PluginHostAccess> => {
      const found = reachable().find((h) => h.id === id);
      return found
        ? {
            hasAccess: true,
            isOwner: found.userId === mock.ctx.currentActor(),
            isShared: false,
            permissionLevel: "manage",
          }
        : { hasAccess: false, isOwner: false, isShared: false };
    },
  });
}

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
    users?: string[];
    hosts?: Record<string, PluginHostSummary[]>;
  } = {},
): Promise<TestServer> {
  const db = await createTestDb(pluginDir);
  for (const user of options.users ?? ["user-1", "user-2"]) {
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
    permissions: options.permissions ?? ["tunnels.use"],
  });
  withHosts(mock, options.hosts ?? { "user-1": [host()] });

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
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async close() {
      for (const dispose of [...mock.disposals].reverse()) await dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}
