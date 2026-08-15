import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import fs from "fs/promises";
import os from "os";
import path from "path";
import express, {
  type Request,
  type RequestHandler,
  type Response,
} from "express";

const state = vi.hoisted(() => ({
  userId: "admin-1",
  settings: {} as Record<string, string>,
  sessions: [] as unknown[],
}));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../../../hosts/terminal/session-manager.js", () => ({
  sessionManager: {
    getUserSessions: () => state.sessions,
  },
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings[key] ?? null,
    set: async (key: string, value: string) => {
      state.settings[key] = value;
    },
    setMany: async (writes: Array<{ key: string; value: string }>) => {
      for (const write of writes) state.settings[write.key] = write.value;
    },
  }),
}));

const { registerUserImageStorageRoutes } = await import(
  "../../../database/routes/user-image-storage-routes.js"
);

const requireAdmin: RequestHandler = (_req, _res, next) => next();
const router = express.Router();
registerUserImageStorageRoutes(router, requireAdmin);

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function handlerFor(pathName: string, method: string): RequestHandler {
  const layer = (router as unknown as { stack: RouteLayer[] }).stack.find(
    (candidate) =>
      candidate.route?.path === pathName && candidate.route.methods[method],
  );
  if (!layer) throw new Error(`Route not registered: ${method} ${pathName}`);
  return layer.route!.stack[layer.route!.stack.length - 1]!.handle;
}

const getHandler = handlerFor("/terminal-image-storage-settings", "get");
const patchHandler = handlerFor("/terminal-image-storage-settings", "patch");
const testHandler = handlerFor("/terminal-image-storage-settings/test", "post");

async function invoke(handler: RequestHandler, body?: unknown) {
  const req = {
    userId: state.userId,
    body: body ?? {},
    headers: {},
  } as unknown as Request;
  const result = { statusCode: 200, body: null as unknown };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      result.body = payload;
      return this;
    },
  } as unknown as Response;
  await handler(req, res, () => {});
  return result;
}

/** Fake ssh2 exec channel: every command exits 0. */
function fakeSshConn() {
  return {
    exec(
      _command: string,
      callback: (error: Error | undefined, stream?: unknown) => void,
    ) {
      const stream = new EventEmitter() as EventEmitter & {
        resume: () => void;
      };
      stream.resume = () => queueMicrotask(() => stream.emit("close", 0));
      callback(undefined, stream);
    },
  };
}

const LEGACY_ENV_NAMES = [
  "TERMIX_IMAGE_STORAGE_MODE",
  "TERMIX_IMAGE_DIR",
  "TERMIX_IMAGE_HOST_PATH",
  "TERMIX_IMAGE_TTL_MS",
  "TERMIX_MAX_IMAGE_COUNT",
  "TERMIX_MAX_IMAGE_STORAGE_BYTES",
  "DATA_DIR",
];

let savedEnv: Record<string, string | undefined>;
let localDir: string;

beforeEach(async () => {
  state.settings = {};
  state.sessions = [];
  savedEnv = Object.fromEntries(
    LEGACY_ENV_NAMES.map((name) => [name, process.env[name]]),
  );
  for (const name of LEGACY_ENV_NAMES) delete process.env[name];
  localDir = await fs.mkdtemp(path.join(os.tmpdir(), "termix-image-test-"));
});

afterEach(async () => {
  for (const name of LEGACY_ENV_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  await fs.rm(localDir, { recursive: true, force: true });
});

describe("GET /users/terminal-image-storage-settings", () => {
  it("returns the public settings shape without the backend localDir", async () => {
    state.settings["terminal_image_storage_mode"] = "local";
    state.settings["terminal_image_local_dir"] = localDir;
    state.settings["terminal_image_host_path"] = "/mnt/images";

    const response = await invoke(getHandler);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      mode: "local",
      hostPath: "/mnt/images",
      ttlMs: 3_600_000,
      maxCount: 100,
      maxBytes: 5_368_709_120,
      localMappingConfigured: true,
    });
    expect(JSON.stringify(response.body)).not.toContain(localDir);
  });
});

describe("PATCH /users/terminal-image-storage-settings", () => {
  it("rejects an invalid mode with a safe 400", async () => {
    const response = await invoke(patchHandler, { mode: "nfs" });
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid value for mode",
      code: "IMAGE_STORAGE_SETTINGS_INVALID",
      field: "mode",
    });
  });

  it("rejects a relative localDir", async () => {
    const response = await invoke(patchHandler, { localDir: "images/tmp" });
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      code: "IMAGE_STORAGE_SETTINGS_INVALID",
      field: "localDir",
    });
    expect(JSON.stringify(response.body)).not.toContain("images/tmp");
  });

  it("rejects out-of-range numeric limits", async () => {
    const response = await invoke(patchHandler, { maxBytes: 1024 });
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      code: "IMAGE_STORAGE_SETTINGS_INVALID",
      field: "maxBytes",
    });
  });

  it("rejects unknown fields without writing anything", async () => {
    const response = await invoke(patchHandler, { shellPath: "/tmp/x" });
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      code: "IMAGE_STORAGE_SETTINGS_UNKNOWN_FIELD",
    });
    expect(state.settings).toEqual({});
  });

  it("persists a valid partial update and returns the public shape", async () => {
    const response = await invoke(patchHandler, {
      mode: "local",
      localDir,
      hostPath: "/host/images",
      ttlMs: 60_000,
      maxCount: 5,
      maxBytes: 10_485_760,
    });

    expect(response.statusCode).toBe(200);
    expect(state.settings).toEqual({
      terminal_image_storage_mode: "local",
      terminal_image_local_dir: localDir,
      terminal_image_host_path: "/host/images",
      terminal_image_ttl_ms: "60000",
      terminal_image_max_count: "5",
      terminal_image_max_storage_bytes: "10485760",
    });
    expect(response.body).toMatchObject({
      mode: "local",
      hostPath: "/host/images",
      ttlMs: 60_000,
      maxCount: 5,
      maxBytes: 10_485_760,
      localMappingConfigured: true,
    });
    expect(JSON.stringify(response.body)).not.toContain(localDir);
  });
});

describe("POST /users/terminal-image-storage-settings/test", () => {
  it("requires an instanceId", async () => {
    const response = await invoke(testHandler, {});
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: "IMAGE_SESSION_MISSING" });
  });

  it("reports unavailable storage when no session is connected", async () => {
    const response = await invoke(testHandler, { instanceId: "tab-1" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      mode: "auto",
      connected: false,
      remoteSftpAvailable: false,
      localHostVisible: null,
      selectedMode: "unavailable",
      localMappingConfigured: false,
    });
  });

  it("probes local visibility through the connected session only", async () => {
    state.settings["terminal_image_local_dir"] = localDir;
    state.settings["terminal_image_host_path"] = "/host/images";
    state.sessions = [
      {
        tabInstanceId: "tab-1",
        isConnected: true,
        sshConn: fakeSshConn(),
      },
    ];

    const response = await invoke(testHandler, { instanceId: "tab-1" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      mode: "auto",
      connected: true,
      remoteSftpAvailable: true,
      localHostVisible: true,
      selectedMode: "local",
      localMappingConfigured: true,
    });
    // The bounded probe cleans up after itself.
    expect((await fs.readdir(localDir)).filter((f) => f.includes("probe")))
      .toEqual([]);
  });

  it("does not probe sessions owned by other instance IDs", async () => {
    state.sessions = [
      {
        tabInstanceId: "tab-2",
        isConnected: true,
        sshConn: fakeSshConn(),
      },
    ];

    const response = await invoke(testHandler, { instanceId: "tab-1" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      connected: false,
      remoteSftpAvailable: false,
      localHostVisible: null,
      selectedMode: "unavailable",
    });
  });
});
