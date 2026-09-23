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
    hosts?: Array<{
      id: number;
      userId: string;
      name?: string;
      ip?: string;
      tags?: string | null;
    }>;
  } = {},
): Promise<TestServer> {
  const hosts = options.hosts ?? [
    { id: 10, userId: "user-1", name: "host-a", ip: "10.0.0.1" },
    { id: 11, userId: "user-1", name: "host-b", ip: "10.0.0.2" },
  ];

  const db = await createTestDb(pluginDir, {
    before: (sqlite) => {
      for (const user of options.users ?? ["user-1", "user-2"]) {
        sqlite
          .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
          .run(user, user);
      }
      // The plugin's fleet_members/fleet_inventory tables FK to ssh_data,
      // which ctx.hosts (faked below) never touches - seed it directly so
      // the constraint is satisfied the way it is against the real table.
      for (const host of hosts) {
        sqlite.prepare("INSERT INTO ssh_data (id) VALUES (?)").run(host.id);
      }
    },
  });

  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    permissions: options.permissions ?? [
      "fleets.view",
      "fleets.manage",
      "fleets.execute",
    ],
  });

  // ctx.hosts is capability-checked separately from ctx.db; seed it with the
  // same fixture hosts a real deployment would resolve through core.
  mock.ctx.hosts.list = async () =>
    hosts.map((h) => ({
      id: h.id,
      userId: h.userId,
      name: h.name ?? null,
      ip: h.ip ?? "",
      port: 22,
      username: "root",
      tags: h.tags ?? null,
      folder: null,
      authType: "password",
    }));
  mock.ctx.hosts.get = async (hostId) => {
    const found = hosts.find((h) => h.id === hostId);
    if (!found) return null;
    return {
      id: found.id,
      userId: found.userId,
      name: found.name ?? null,
      ip: found.ip ?? "",
      port: 22,
      username: "root",
      tags: found.tags ?? null,
      folder: null,
      authType: "password",
    };
  };
  mock.ctx.hosts.checkAccess = async (hostId) => {
    const found = hosts.find((h) => h.id === hostId);
    if (!found) return { hasAccess: false, isOwner: false, isShared: false };
    return {
      hasAccess: true,
      isOwner: true,
      isShared: false,
      permissionLevel: "manage",
    };
  };

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
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}
