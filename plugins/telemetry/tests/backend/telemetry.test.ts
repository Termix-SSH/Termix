import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import express, { type Router } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockCtx,
  createTestDb,
  type MockPluginContext,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activateWith } from "../../src/backend/index.js";
import {
  DEFAULT_POSTHOG_API_KEY,
  envOverride,
  posthogConfig,
} from "../../src/backend/config.js";
import { detectDeployment } from "../../src/backend/collect.js";
import {
  MAX_FEATURES,
  sanitizeUsage,
  usageProperty,
} from "../../src/backend/usage.js";
import { CHECK_INTERVAL_MS } from "../../src/backend/reporter.js";

const manifest = manifestJson as unknown as PluginManifest;
const pluginDir = fileURLToPath(new URL("../..", import.meta.url));

interface Sent {
  url: string;
  body: Record<string, unknown> & { properties: Record<string, unknown> };
}

let cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

async function setup(
  options: {
    settings?: Record<string, unknown>;
    env?: Record<string, string | undefined>;
    permissions?: string[];
    status?: number;
  } = {},
) {
  const db: TestDb = await createTestDb(pluginDir);
  db.sqlite
    .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
    .run("u1", "u1");
  db.sqlite
    .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
    .run("u2", "u2");
  db.sqlite.prepare("INSERT INTO ssh_data (id) VALUES (?)").run(1);

  const sent: Sent[] = [];
  let router: Router | null = null;
  const mock: MockPluginContext = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    settings: options.settings,
    permissions: options.permissions ?? ["manage"],
    installedPlugins: [
      { id: "telemetry", version: "1.0.0", source: "bundled", state: "active" },
      { id: "docker", version: "1.0.0", source: "bundled", state: "active" },
      { id: "serial", version: "1.0.0", source: "bundled", state: "stopped" },
    ],
    fetch: async (url, init) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: options.status ?? 200 });
    },
  });
  mock.setActor("u1");

  const env = { VERSION: "2.9.0", ...options.env };
  const { reporter, usage } = await activateWith(mock.ctx, env);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    mock.setActor(req.header("x-test-user") ?? "u1");
    next();
  });
  app.use((req, res, next) => router!(req, res, next));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
    () => db.close(),
  );

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    user = "u1",
  ) => {
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
  };

  return { mock, reporter, usage, sent, call };
}

describe("config", () => {
  it("reads ENABLE_TELEMETRY as a lock only when set", () => {
    expect(envOverride({})).toBeNull();
    expect(envOverride({ ENABLE_TELEMETRY: " " })).toBeNull();
    expect(envOverride({ ENABLE_TELEMETRY: "TRUE" })).toBe(true);
    expect(envOverride({ ENABLE_TELEMETRY: "false" })).toBe(false);
    expect(envOverride({ ENABLE_TELEMETRY: "no" })).toBe(false);
  });

  it("uses the embedded key unless the env sets one", () => {
    expect(posthogConfig({})).toEqual({
      apiKey: DEFAULT_POSTHOG_API_KEY,
      host: "https://us.i.posthog.com",
    });
    expect(
      posthogConfig({
        POSTHOG_API_KEY: "k",
        POSTHOG_HOST: "https://ph.local/",
      }),
    ).toEqual({ apiKey: "k", host: "https://ph.local" });
  });

  it("detects how Termix runs", () => {
    expect(detectDeployment({ ELECTRON_EMBEDDED: "true" }, () => true)).toBe(
      "desktop",
    );
    expect(detectDeployment({}, () => true)).toBe("docker");
    expect(detectDeployment({}, () => false)).toBe("server");
  });
});

describe("usage counts", () => {
  it("keeps valid names and positive whole counts", () => {
    expect(
      sanitizeUsage({
        "tab.terminal": 2.7,
        "Bad Name": 1,
        zero: 0,
        neg: -3,
        nan: "x",
        big: 1e9,
      }),
    ).toEqual({ "tab.terminal": 2, big: 100_000 });
    expect(sanitizeUsage(null)).toEqual({});
    expect(sanitizeUsage([1])).toEqual({});
  });

  it("caps the number of features", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_FEATURES + 20 }, (_, i) => [`f${i}`, 1]),
    );
    expect(Object.keys(sanitizeUsage(many))).toHaveLength(MAX_FEATURES);
  });

  it("maps a feature to a property name", () => {
    expect(usageProperty("tab.file-manager")).toBe("used_tab_file_manager");
  });
});

describe("reporting", () => {
  it("sends a full report with every section on", async () => {
    const { mock, usage, sent } = await setup();
    await usage.add({ "tab.terminal": 3 });
    mock.ctx.events.emit("host.login", { hostId: 1 });
    mock.ctx.events.emit("host.session.status", { hostId: 1, online: true });
    mock.ctx.events.emit("host.session.status", { hostId: 1, online: false });
    await vi.waitFor(async () =>
      expect(await usage.read()).toMatchObject({
        ssh_login: 1,
        host_connected: 1,
      }),
    );

    await mock.runScheduled();

    expect(sent).toHaveLength(1);
    const { url, body } = sent[0];
    expect(url).toBe("https://us.i.posthog.com/capture/");
    expect(body.api_key).toBe(DEFAULT_POSTHOG_API_KEY);
    expect(body.event).toBe("instance_heartbeat");
    expect(typeof body.distinct_id).toBe("string");
    expect(body.properties).toMatchObject({
      version: "2.9.0",
      user_count: 2,
      host_count: 1,
      os: process.platform,
      arch: process.arch,
      db_dialect: "sqlite",
      used_tab_terminal: 3,
      used_ssh_login: 1,
      used_host_connected: 1,
      plugins_enabled: ["docker", "telemetry"],
      plugin_count: 2,
    });
    expect(await usage.read()).toEqual({});
  });

  it("checks hourly and sends at most once a day", async () => {
    const { mock, sent } = await setup();
    expect(mock.scheduled.find((job) => job.kind === "every")?.ms).toBe(
      CHECK_INTERVAL_MS,
    );
    await mock.runScheduled();
    await mock.runScheduled();
    expect(sent).toHaveLength(1);
  });

  it("leaves out each section when its switch is off", async () => {
    const { mock, usage, sent } = await setup({
      settings: {
        includePlatform: false,
        includeFeatureUsage: false,
        includePlugins: false,
      },
    });
    await usage.add({ "tab.terminal": 1 });
    await mock.runScheduled();
    expect(Object.keys(sent[0].body.properties).sort()).toEqual([
      "host_count",
      "user_count",
      "version",
    ]);
    expect(await usage.read()).toEqual({ "tab.terminal": 1 });
  });

  it("sends nothing and counts nothing while turned off", async () => {
    const { mock, usage, sent } = await setup({ settings: { enabled: false } });
    mock.ctx.events.emit("host.login", { hostId: 1 });
    await mock.runScheduled();
    expect(sent).toEqual([]);
    expect(await usage.read()).toEqual({});
  });

  it("lets ENABLE_TELEMETRY win over the admin switch", async () => {
    const off = await setup({ env: { ENABLE_TELEMETRY: "false" } });
    await off.mock.runScheduled();
    expect(off.sent).toEqual([]);

    const on = await setup({
      settings: { enabled: false },
      env: { ENABLE_TELEMETRY: "true" },
    });
    await on.mock.runScheduled();
    expect(on.sent).toHaveLength(1);
  });

  it("keeps the 2.8 instance id", async () => {
    const { mock, sent } = await setup({
      settings: { instanceId: "legacy-id" },
    });
    await mock.runScheduled();
    expect(sent[0].body.distinct_id).toBe("legacy-id");
  });

  it("records a failed send and keeps the counts", async () => {
    const { mock, reporter, usage, sent } = await setup({ status: 500 });
    await usage.add({ "tab.terminal": 1 });
    await mock.runScheduled();
    expect(sent.length).toBeGreaterThan(0);
    const state = await reporter.state();
    expect(state.lastError).toBe("PostHog answered 500");
    expect(state.lastSentAt).toBeNull();
    expect(await usage.read()).toEqual({ "tab.terminal": 1 });
  });

  it("refuses a change to the switch while ENABLE_TELEMETRY locks it", async () => {
    const locked = await setup({ env: { ENABLE_TELEMETRY: "true" } });
    expect(
      await locked.mock.validateSettings("admin", { enabled: false }),
    ).toHaveProperty("enabled");
    expect(
      await locked.mock.validateSettings("admin", { enabled: true }),
    ).not.toHaveProperty("enabled");

    const free = await setup();
    expect(
      await free.mock.validateSettings("admin", { enabled: false }),
    ).not.toHaveProperty("enabled");
  });
});

describe("routes", () => {
  it("serves status, preview, send and reset to a manager", async () => {
    const { call, sent } = await setup();

    const preview = await call("GET", "/preview");
    expect(preview.status).toBe(200);
    expect(preview.body.event).toBe("instance_heartbeat");
    expect(preview.body).not.toHaveProperty("api_key");
    expect(sent).toEqual([]);

    expect((await call("POST", "/send")).body).toEqual({ sent: true });
    const status = await call("GET", "/status");
    expect(status.body).toMatchObject({
      enabled: true,
      locked: false,
      lastError: null,
    });
    expect(status.body.lastSentAt).toBeTruthy();
    expect(status.body.nextDueAt).toBeTruthy();

    const before = status.body.instanceId;
    const reset = await call("POST", "/reset-id");
    expect(reset.body.instanceId).not.toBe(before);
  });

  it("answers 502 when the report cannot be delivered", async () => {
    const { call } = await setup({ status: 503 });
    const response = await call("POST", "/send");
    expect(response.status).toBe(502);
    expect(response.body.error).toBe("PostHog answered 503");
  });

  it("keeps the admin routes from users without manage", async () => {
    const { call } = await setup({ permissions: [] });
    for (const [method, path] of [
      ["GET", "/status"],
      ["GET", "/preview"],
      ["POST", "/send"],
      ["POST", "/reset-id"],
    ]) {
      expect((await call(method, path)).status).toBe(403);
    }
    expect((await call("GET", "/usage/config")).status).toBe(200);
  });

  it("records usage only for users who are counted", async () => {
    const { mock, call, usage } = await setup({ permissions: [] });
    expect((await call("GET", "/usage/config")).body).toEqual({ track: true });

    await call("POST", "/usage", {
      features: { "tab.terminal": 2, "BAD!": 5 },
    });
    expect(await usage.read()).toEqual({ "tab.terminal": 2 });

    await mock.ctx.settings.setUser("u2", "shareFeatureUsage", false);
    expect((await call("GET", "/usage/config", undefined, "u2")).body).toEqual({
      track: false,
    });
    const ignored = await call(
      "POST",
      "/usage",
      { features: { "tab.terminal": 9 } },
      "u2",
    );
    expect(ignored.status).toBe(204);
    expect(await usage.read()).toEqual({ "tab.terminal": 2 });
  });

  it("counts nobody while feature usage is off", async () => {
    const { call, usage } = await setup({
      settings: { includeFeatureUsage: false },
    });
    expect((await call("GET", "/usage/config")).body).toEqual({ track: false });
    await call("POST", "/usage", { features: { "tab.terminal": 1 } });
    expect(await usage.read()).toEqual({});
  });
});
