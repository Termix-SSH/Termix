import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import express, { type Router } from "express";
import {
  createMockCtx,
  createTestDb,
  type MockPluginContext,
  type TestDb,
  type TestDbOptions,
} from "@termix/plugin-sdk/testing";
import type { PluginSshKeyCredential } from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

/** Core's ssh_credentials, which the keys table points at. */
export const CREDENTIALS_DDL =
  "CREATE TABLE IF NOT EXISTS ssh_credentials (id INTEGER PRIMARY KEY AUTOINCREMENT)";

export interface TestServer {
  db: TestDb;
  mock: MockPluginContext;
  request: (
    method: string,
    path: string,
    options?: {
      user?: string | null;
      body?: unknown;
      headers?: Record<string, string>;
    },
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any; text: string; headers: Headers }>;
  close: () => Promise<void>;
}

/**
 * The plugin activated against a real in-memory database, its router mounted
 * the way core mounts it: JSON parsed, the acting user taken from the request,
 * and a request without one refused unless its path is public.
 */
export async function startServer(
  options: {
    permissions?: string[];
    capabilities?: string[];
    sshKeyCredentials?: PluginSshKeyCredential[];
    before?: TestDbOptions["before"];
  } = {},
): Promise<TestServer> {
  const db = await createTestDb(pluginDir, {
    before: (sqlite) => {
      sqlite.exec(CREDENTIALS_DDL);
      options.before?.(sqlite);
    },
  });
  for (const user of ["user-1", "user-2"]) {
    db.sqlite.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(user);
  }
  // Credential ids the fake ctx.credentials hands out.
  for (let id = 1; id <= 10; id++) {
    db.sqlite
      .prepare("INSERT OR IGNORE INTO ssh_credentials (id) VALUES (?)")
      .run(id);
  }

  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: options.capabilities ?? manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    permissions: options.permissions,
    sshKeyCredentials: options.sshKeyCredentials,
    actor: "user-1",
  });

  const { activate } = await import("../../src/backend/index.js");
  await activate(mock.ctx);

  const publicPaths = mock.httpRouters[0]?.public ?? [];
  const isPublic = (path: string) =>
    publicPaths.some((pattern) => {
      const want = pattern.split("/");
      const got = path.split("/");
      return (
        want.length === got.length &&
        want.every((part, i) => part.startsWith(":") || part === got[i])
      );
    });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const user = req.header("x-test-user") || undefined;
    if (!user && !isPublic(req.path)) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    mock.setActor(user);
    next();
  });
  app.use((req, res, next) => router!(req, res, next));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    db,
    mock,
    async request(method, path, { user = "user-1", body, headers } = {}) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        redirect: "manual",
        headers: {
          ...(user ? { "x-test-user": user } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return {
        status: response.status,
        body: parsed,
        text,
        headers: response.headers,
      };
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}
