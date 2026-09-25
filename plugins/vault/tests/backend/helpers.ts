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
import type {
  PluginFetchInit,
  PluginSshAuthProvider,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

export const VAULT_ADDR = "https://vault.internal:8200";
export const SIGNED_CERT = "ssh-ed25519-cert-v01@openssh.com AAAAsigned";

/** A fake Vault answering the three calls the plugin makes. */
export function createFakeVault(
  options: { signStatus?: number; state?: string } = {},
) {
  const calls: Array<{ url: string; init?: PluginFetchInit }> = [];
  const state = options.state ?? "vault-state-1";
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status });

  const fetch = async (url: string, init?: PluginFetchInit) => {
    calls.push({ url, init });
    const { pathname } = new URL(url);
    if (pathname === "/v1/auth/oidc/oidc/auth_url") {
      return json(200, {
        data: {
          auth_url: `https://idp.test/authorize?client_id=termix&state=${state}`,
        },
      });
    }
    if (pathname === "/v1/auth/oidc/oidc/callback") {
      return json(200, { auth: { client_token: "hvs.token" } });
    }
    if (pathname.startsWith("/v1/ssh-client-signer/sign/")) {
      if (options.signStatus && options.signStatus !== 200) {
        return json(options.signStatus, { errors: ["permission denied"] });
      }
      return json(200, { data: { signed_key: SIGNED_CERT } });
    }
    return json(404, { errors: ["not found"] });
  };
  return { fetch, calls, state };
}

/** A fake terminal socket that records what it was sent. */
export function fakeSocket() {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    socket: { send: (data: string) => sent.push(JSON.parse(data)) },
  };
}

export interface TestServer {
  db: TestDb;
  mock: MockPluginContext;
  provider: () => PluginSshAuthProvider;
  request: (
    method: string,
    path: string,
    options?: { user?: string; body?: unknown },
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any; text: string }>;
  close: () => Promise<void>;
}

/**
 * The plugin activated against a real in-memory database, its router mounted
 * the way core mounts it: JSON parsed and the acting user taken from the
 * request.
 */
export async function startServer(
  options: {
    permissions?: string[];
    settings?: Record<string, unknown>;
    fetch?: (url: string, init?: PluginFetchInit) => Promise<Response>;
    before?: TestDbOptions["before"];
  } = {},
): Promise<TestServer> {
  const db = await createTestDb(pluginDir, { before: options.before });
  for (const user of ["user-1", "user-2"]) {
    db.sqlite.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(user);
  }
  db.sqlite.prepare("INSERT OR IGNORE INTO ssh_data (id) VALUES (?)").run(7);

  let router: Router | null = null;
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    permissions: options.permissions,
    settings: options.settings,
    fetch: options.fetch,
    actor: "user-1",
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
    provider: () =>
      mock.auth.sshAuthProviders.find((provider) => provider.type === "vault")!,
    async request(method, path, { user = "user-1", body } = {}) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        redirect: "manual",
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
        parsed = null;
      }
      return { status: response.status, body: parsed, text };
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}

export const env = (userId = "user-1", hostId = 7) => ({
  client: {},
  userId,
  hostId,
  purpose: "terminal",
  interactive: true,
  log: () => {},
});

export const HOST = { id: 7, ip: "10.0.0.7", port: 22, username: "root" };

export const PROFILE = {
  name: "Prod",
  vaultAddr: VAULT_ADDR,
  sshRole: "ops",
  oidcRole: "dev",
};
