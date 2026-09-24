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
import type { LiveSessionInfo } from "../../src/backend/live.js";
import type {
  SessionGuestsV1,
  SessionSharingV1,
} from "../../src/backend/services.js";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

/** A stand-in for the terminal's "ssh" sessions.live provider. */
export function createFakeLive() {
  const sessions = new Map<string, LiveSessionInfo>();
  const calls: Array<[string, ...unknown[]]> = [];
  return {
    sessions,
    calls,
    addSession(id: string, userId: string, hostId = 1) {
      sessions.set(id, {
        id,
        userId,
        hostId,
        hostName: `host-${hostId}`,
        isConnected: true,
        createdAt: 1,
        tabInstanceId: `tab-${id}`,
      });
    },
    provider: {
      getSession: (id: string) => sessions.get(id) ?? null,
      ownerEndSession: (...args: unknown[]) => {
        calls.push(["ownerEndSession", ...args]);
      },
      disconnectParticipants: (...args: unknown[]) => {
        calls.push(["disconnectParticipants", ...args]);
        return 0;
      },
      setRoomShareControl: (...args: unknown[]) => {
        calls.push(["setRoomShareControl", ...args]);
      },
    },
  };
}

export interface TestServer {
  db: TestDb;
  mock: MockPluginContext;
  live: ReturnType<typeof createFakeLive>;
  sharing: SessionSharingV1;
  guests: SessionGuestsV1;
  request: (
    method: string,
    path: string,
    options?: { user?: string | null; body?: unknown },
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

/**
 * The plugin activated against a real in-memory database, its router mounted
 * the way core mounts it: JSON parsed and the acting user set from the
 * request (none for a guest), everything else left to the plugin.
 */
export async function startServer(
  options: {
    permissions?: string[];
    users?: string[];
    admins?: string[];
    hostIds?: number[];
    /** Hosts ctx.hosts.checkAccess grants. Defaults to every host. */
    accessibleHostIds?: number[];
    settings?: Record<string, unknown>;
  } = {},
): Promise<TestServer> {
  const db = await createTestDb(pluginDir);
  for (const user of options.users ?? ["alice", "bob", "carol"]) {
    db.sqlite
      .prepare("INSERT INTO users (id, username, is_admin) VALUES (?, ?, ?)")
      .run(user, user, options.admins?.includes(user) ? 1 : 0);
  }
  const hostIds = options.hostIds ?? [1, 2];
  for (const id of hostIds) {
    db.sqlite.prepare("INSERT INTO ssh_data (id) VALUES (?)").run(id);
  }

  const live = createFakeLive();
  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    permissions: options.permissions ?? ["session-sharing.use"],
    settings: options.settings,
    hosts: (options.accessibleHostIds ?? hostIds).map((id) => ({
      id,
      userId: "alice",
      name: `host-${id}`,
      ip: "10.0.0.1",
      port: 22,
      username: "root",
      tags: [],
      folder: null,
      authType: "password",
    })) as never,
    services: { "sessions.live#ssh": live.provider },
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
    live,
    sharing: mock.services.get("sessions.sharing") as SessionSharingV1,
    guests: mock.ctx.registry.consume<SessionGuestsV1>(
      "sessions.sharing.guests",
    )!,
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
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const dispose of [...mock.disposals].reverse()) {
        await Promise.resolve(dispose()).catch(() => {});
      }
      db.close();
    },
  };
}

/** Runs a service call the way a consumer's handle does: as that user. */
export function asUser<T>(
  server: TestServer,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return server.mock.ctx.asUser(userId, fn);
}

export function expireShare(server: TestServer, shareId: string): void {
  server.db.sqlite
    .prepare("UPDATE p_session_sharing_shares SET expires_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 60_000).toISOString(), shareId);
}
