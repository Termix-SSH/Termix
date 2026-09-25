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
  PluginNotifyHub,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

export interface FetchCall {
  url: string;
  init?: PluginFetchInit;
}

export interface TestServer {
  db: TestDb;
  mock: MockPluginContext;
  hub: PluginNotifyHub;
  fetches: FetchCall[];
  /** Where the router is served, for a raw fetch such as the stream. */
  url: string;
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
 * the way core mounts it, with every outbound request answered by `respond`.
 */
export async function startServer(
  options: {
    permissions?: string[];
    settings?: Record<string, unknown>;
    coreSettings?: Record<string, string>;
    respond?: (url: string, init?: PluginFetchInit) => Response;
  } = {},
): Promise<TestServer> {
  const db = await createTestDb(pluginDir);
  for (const user of ["alice", "bob"]) {
    db.sqlite
      .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
      .run(user, user);
  }

  const fetches: FetchCall[] = [];
  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    permissions: options.permissions ?? ["alerts.use"],
    settings: options.settings,
    coreSettings: options.coreSettings,
    fetch: async (url, init) => {
      fetches.push({ url, init });
      return options.respond?.(url, init) ?? new Response("ok");
    },
  });

  const { activate } = await import("../../src/backend/index.js");
  await activate(mock.ctx);
  const hub = mock.notifyHub.current;
  if (!hub) throw new Error("The plugin did not serve a hub");

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
    hub,
    fetches,
    url: `http://127.0.0.1:${port}`,
    async request(method, path, { user = "alice", body: given } = {}) {
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
      for (const dispose of [...mock.disposals].reverse()) {
        await Promise.resolve(dispose()).catch(() => {});
      }
      db.close();
    },
  };
}

/** A channel for alice through the route, returning its id. */
export async function addChannel(
  server: TestServer,
  body: Record<string, unknown>,
  user = "alice",
): Promise<number> {
  const response = await server.request("POST", "/channels", { user, body });
  if (response.status !== 201) {
    throw new Error(`channel not created: ${JSON.stringify(response.body)}`);
  }
  return response.body.id;
}

export const WEBHOOK = {
  name: "ops",
  type: "webhook",
  config: { url: "https://hooks.example/alert" },
};
