import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Router } from "express";
import {
  createMockCtx,
  type MockContextOptions,
  type MockPluginContext,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";
import { FakeClient } from "./fake-ssh";

export const manifest = manifestJson as unknown as PluginManifest;

export const PS_LINE =
  '{"id":"abc123","name":"web","image":"nginx","status":"Up 2 hours","state":"running","ports":"80/tcp","created":"2026-01-01"}';

/** A host owned by user-1, as ctx.ssh.resolveHost sees it. */
export function sshHost(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId: "user-1",
    name: `host-${id}`,
    ip: `10.0.0.${id}`,
    port: 22,
    username: "root",
    authType: "password",
    password: "pw",
    ...extra,
  };
}

/** A client that looks like a Linux host with Docker running. */
export function dockerClient(): FakeClient {
  return new FakeClient([
    [/^ver$/, { stdout: "" }],
    [/--version/, { stdout: "Docker version 27.1.1, build abc" }],
    [/ ps -a --format/, { stdout: `${PS_LINE}\n` }],
    [/ ps$/, { stdout: "" }],
  ]);
}

export interface TestServer {
  mock: MockPluginContext;
  client: FakeClient;
  request: (
    method: string,
    path: string,
    options?: { user?: string; body?: unknown },
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

/** The plugin activated with its router served the way core mounts it. */
export async function startServer(
  options: {
    permissions?: string[];
    dockerOn?: boolean;
    client?: FakeClient;
    mock?: Partial<MockContextOptions>;
  } = {},
): Promise<TestServer> {
  const client = options.client ?? dockerClient();
  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    router: () => (router = express.Router()),
    permissions: options.permissions ?? ["docker.use"],
    sshHosts: [sshHost(7), sshHost(8)],
    sshClient: client,
    ...options.mock,
  });
  if (options.dockerOn !== false) {
    await mock.ctx.settings.setHost(7, "enableDocker", true);
  }

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
    mock,
    client,
    async request(method, path, { user = "user-1", body } = {}) {
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
    },
  };
}
