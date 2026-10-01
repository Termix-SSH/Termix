import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import express, { type Router } from "express";
import {
  createMockCtx,
  createTestDb,
  type MockContextOptions,
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

/** A host owned by user-1, as ctx.hosts and ctx.ssh.resolveHost see it. */
export function testHost(id: number, extra: Record<string, unknown> = {}) {
  return {
    summary: {
      id,
      userId: "user-1",
      name: `host-${id}`,
      ip: `10.0.0.${id}`,
      port: 22,
      username: "root",
      tags: null,
      folder: null,
      authType: "password",
    },
    ssh: {
      id,
      userId: "user-1",
      ip: `10.0.0.${id}`,
      port: 22,
      username: "root",
      authType: "password",
      connectionType: "ssh",
      enableSsh: true,
      password: "pw",
      ...extra,
    },
  };
}

/**
 * The plugin activated against a real in-memory database, its router mounted
 * the way core mounts it: JSON parsed and the acting user set per request.
 */
export async function startServer(
  options: {
    permissions?: string[];
    hosts?: number[];
    mock?: Partial<MockContextOptions>;
  } = {},
): Promise<TestServer> {
  const db = await createTestDb(pluginDir);
  for (const user of ["user-1", "user-2"]) {
    db.sqlite
      .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
      .run(user, user);
  }
  const hosts = (options.hosts ?? [7]).map((id) => testHost(id));
  for (const host of hosts) {
    db.sqlite.prepare("INSERT INTO ssh_data (id) VALUES (?)").run(host.ssh.id);
  }

  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    permissions: options.permissions ?? ["host-metrics.use"],
    hosts: hosts.map((host) => host.summary),
    sshHosts: hosts.map((host) => host.ssh),
    ...options.mock,
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
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async close() {
      for (const dispose of mock.disposals.reverse()) await dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}
